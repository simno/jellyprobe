const Database = require('better-sqlite3');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const ENCRYPTION_KEY = process.env.ENCRYPTION_KEY || crypto.randomBytes(32).toString('hex');
const ALGORITHM = 'aes-256-cbc';

class DatabaseManager {
  constructor(dbPath = '/data/jellyprobe.db') {
    this.dbPath = dbPath;
    this.db = null;
  }

  // Allowed field names for dynamic update queries (SQL injection prevention)
  static CONFIG_FIELDS = new Set([
    'jellyfinUrl', 'apiKey', 'scanLibraryId', 'scanLibraryIds',
    'scanInterval', 'testDuration', 'maxParallelTests', 'formats', 
    'showPreviews', 'maxParallelPreviews', 'updatedAt'
  ]);
  static DEVICE_FIELDS = new Set([
    'name', 'deviceId', 'maxBitrate', 'audioCodec', 'videoCodec',
    'maxWidth', 'maxHeight'
  ]);
  static TEST_RUN_FIELDS = new Set([
    'name', 'status', 'config', 'totalTests', 'completedTests',
    'successfulTests', 'failedTests', 'startedAt', 'completedAt'
  ]);
  static SCHEDULE_FIELDS = new Set([
    'name', 'enabled', 'frequency', 'dayOfWeek', 'timeOfDay',
    'deviceIds', 'libraryIds', 'mediaScope', 'mediaDays',
    'testDuration', 'parallelTests', 'lastRunAt', 'nextRunAt'
  ]);

  initialize() {
    const dir = path.dirname(this.dbPath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }

    this.db = new Database(this.dbPath);
    this.db.pragma('journal_mode = WAL');
    this.createTables();
    this.migrateSchema();
    this.seedDefaultConfig();
  }

  createTables() {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS config (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        jellyfinUrl TEXT NOT NULL,
        apiKey TEXT NOT NULL,
        scanLibraryId TEXT,
        scanLibraryIds TEXT,
        scanInterval INTEGER DEFAULT 300,
        testDuration INTEGER DEFAULT 30,
        maxParallelTests INTEGER DEFAULT 1,
        showPreviews INTEGER DEFAULT 1,
        maxParallelPreviews INTEGER DEFAULT 6,
        formats TEXT DEFAULT '["mp4","mkv","avi"]',
        createdAt DATETIME DEFAULT CURRENT_TIMESTAMP,
        updatedAt DATETIME DEFAULT CURRENT_TIMESTAMP
      );

      CREATE TABLE IF NOT EXISTS devices (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL,
        deviceId TEXT UNIQUE NOT NULL,
        maxBitrate INTEGER DEFAULT 20000000,
        audioCodec TEXT DEFAULT 'aac',
        videoCodec TEXT DEFAULT 'h264',
        maxWidth INTEGER DEFAULT 1920,
        maxHeight INTEGER DEFAULT 1080,
        createdAt DATETIME DEFAULT CURRENT_TIMESTAMP
      );

      CREATE TABLE IF NOT EXISTS test_runs (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL,
        status TEXT DEFAULT 'pending',
        config TEXT,
        totalTests INTEGER DEFAULT 0,
        completedTests INTEGER DEFAULT 0,
        successfulTests INTEGER DEFAULT 0,
        failedTests INTEGER DEFAULT 0,
        createdAt DATETIME DEFAULT CURRENT_TIMESTAMP,
        startedAt DATETIME,
        completedAt DATETIME
      );

      CREATE TABLE IF NOT EXISTS tests (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        testRunId INTEGER,
        itemId TEXT NOT NULL,
        itemName TEXT,
        path TEXT,
        deviceId INTEGER,
        format TEXT,
        duration INTEGER,
        errors TEXT,
        timestamp DATETIME DEFAULT CURRENT_TIMESTAMP,
        success INTEGER DEFAULT 0,
        FOREIGN KEY (deviceId) REFERENCES devices(id),
        FOREIGN KEY (testRunId) REFERENCES test_runs(id)
      );

      CREATE TABLE IF NOT EXISTS scan_state (
        id INTEGER PRIMARY KEY CHECK (id = 1),
        lastScanTime DATETIME,
        itemsQueued INTEGER DEFAULT 0
      );

      CREATE TABLE IF NOT EXISTS scheduled_runs (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL,
        enabled INTEGER DEFAULT 1,
        frequency TEXT NOT NULL,
        dayOfWeek INTEGER,
        timeOfDay TEXT NOT NULL,
        deviceIds TEXT NOT NULL,
        libraryIds TEXT NOT NULL,
        mediaScope TEXT NOT NULL DEFAULT 'all',
        mediaDays INTEGER DEFAULT 7,
        testDuration INTEGER DEFAULT 30,
        parallelTests INTEGER DEFAULT 2,
        lastRunAt DATETIME,
        nextRunAt DATETIME,
        createdAt DATETIME DEFAULT CURRENT_TIMESTAMP
      );

      CREATE INDEX IF NOT EXISTS idx_tests_timestamp ON tests(timestamp DESC);
      CREATE INDEX IF NOT EXISTS idx_tests_success ON tests(success);
      CREATE INDEX IF NOT EXISTS idx_tests_itemId ON tests(itemId);
      CREATE INDEX IF NOT EXISTS idx_tests_testRunId ON tests(testRunId);
      CREATE INDEX IF NOT EXISTS idx_test_runs_status ON test_runs(status);
    `);
  }

  migrateSchema() {
    // Check if we need to migrate from old schema to new
    const configColumns = this.db.pragma('table_info(config)');
    const hasLibraryIds = configColumns.some(col => col.name === 'scanLibraryIds');
    const hasMaxParallel = configColumns.some(col => col.name === 'maxParallelTests');
    
    if (!hasLibraryIds) {
      // Add new column
      this.db.exec('ALTER TABLE config ADD COLUMN scanLibraryIds TEXT');
      
      // Migrate existing single library ID to array format
      const config = this.db.prepare('SELECT id, scanLibraryId FROM config').get();
      if (config && config.scanLibraryId) {
        const libraryIds = JSON.stringify([config.scanLibraryId]);
        this.db.prepare('UPDATE config SET scanLibraryIds = ? WHERE id = ?')
          .run(libraryIds, config.id);
      } else if (config) {
        this.db.prepare('UPDATE config SET scanLibraryIds = ? WHERE id = ?')
          .run('[]', config.id);
      }
    }
    
    if (!hasMaxParallel) {
      this.db.exec('ALTER TABLE config ADD COLUMN maxParallelTests INTEGER DEFAULT 1');
      this.db.exec('UPDATE config SET maxParallelTests = 1 WHERE maxParallelTests IS NULL');
    }

    const hasShowPreviews = configColumns.some(col => col.name === 'showPreviews');
    if (!hasShowPreviews) {
      this.db.exec('ALTER TABLE config ADD COLUMN showPreviews INTEGER DEFAULT 1');
      this.db.exec('ALTER TABLE config ADD COLUMN maxParallelPreviews INTEGER DEFAULT 6');
    }

    // Migrate tests table for v2.0
    const testColumns = this.db.pragma('table_info(tests)');
    const hasTestRunId = testColumns.some(col => col.name === 'testRunId');
    const hasBytesDownloaded = testColumns.some(col => col.name === 'bytesDownloaded');

    if (!hasTestRunId) {
      this.db.exec('ALTER TABLE tests ADD COLUMN testRunId INTEGER REFERENCES test_runs(id)');
    }

    if (!hasBytesDownloaded) {
      console.log('Adding bytesDownloaded column to tests table...');
      this.db.exec('ALTER TABLE tests ADD COLUMN bytesDownloaded INTEGER DEFAULT 0');
    }

    // Migrate devices table for resolution constraints
    const deviceColumns = this.db.pragma('table_info(devices)');
    const hasMaxWidth = deviceColumns.some(col => col.name === 'maxWidth');
    if (!hasMaxWidth) {
      console.log('Adding maxWidth/maxHeight columns to devices table...');
      this.db.exec('ALTER TABLE devices ADD COLUMN maxWidth INTEGER DEFAULT 1920');
      this.db.exec('ALTER TABLE devices ADD COLUMN maxHeight INTEGER DEFAULT 1080');
      // Update existing 720p profiles
      this.db.exec("UPDATE devices SET maxWidth = 1280, maxHeight = 720 WHERE deviceId LIKE '%-720p'");
    }
  }

  seedDefaultConfig() {
    const existingConfig = this.db.prepare('SELECT COUNT(*) as count FROM config').get();
    
    if (existingConfig.count === 0) {
      const jellyfinUrl = process.env.JELLYFIN_URL || 'http://localhost:8096';
      const apiKey = process.env.API_KEY || '';
      const encryptedApiKey = apiKey ? this.encrypt(apiKey) : '';

      this.db.prepare(`
        INSERT INTO config (jellyfinUrl, apiKey, scanLibraryId, scanLibraryIds, scanInterval, testDuration, maxParallelTests, showPreviews, maxParallelPreviews, formats)
        VALUES (?, ?, '', '[]', 300, 30, 1, 1, 6, '["mp4","mkv","avi","mov","webm"]')
      `).run(jellyfinUrl, encryptedApiKey);

      this.db.prepare(`
        INSERT INTO scan_state (id, lastScanTime, itemsQueued) 
        VALUES (1, datetime('now'), 0)
      `).run();
    }

    const existingDevices = this.db.prepare('SELECT COUNT(*) as count FROM devices').get();
    if (existingDevices.count === 0) {
      // Default profiles representing real device scenarios with codec variety
      const defaultProfiles = [
        {
          name: 'Web Browser - 1080p',
          deviceId: 'jellyprobe-web-1080p',
          maxBitrate: 10000000,
          audioCodec: 'aac',
          videoCodec: 'h264',
          maxWidth: 1920,
          maxHeight: 1080
        },
        {
          name: 'Mobile - 720p',
          deviceId: 'jellyprobe-mobile-720p',
          maxBitrate: 3000000,
          audioCodec: 'aac',
          videoCodec: 'h264',
          maxWidth: 1280,
          maxHeight: 720
        },
        {
          name: 'Smart TV - 4K HEVC',
          deviceId: 'jellyprobe-tv-4k',
          maxBitrate: 80000000,
          audioCodec: 'aac',
          videoCodec: 'hevc',
          maxWidth: 3840,
          maxHeight: 2160
        },
        {
          name: 'Chromecast - 1080p VP9',
          deviceId: 'jellyprobe-chromecast-1080p',
          maxBitrate: 8000000,
          audioCodec: 'opus',
          videoCodec: 'vp9',
          maxWidth: 1920,
          maxHeight: 1080
        },
        {
          name: 'Streaming Box - 4K AV1',
          deviceId: 'jellyprobe-streaming-4k',
          maxBitrate: 20000000,
          audioCodec: 'aac',
          videoCodec: 'av1',
          maxWidth: 3840,
          maxHeight: 2160
        },
        {
          name: 'Legacy Device - 480p',
          deviceId: 'jellyprobe-legacy-480p',
          maxBitrate: 1500000,
          audioCodec: 'aac',
          videoCodec: 'h264',
          maxWidth: 854,
          maxHeight: 480
        }
      ];

      const insertStmt = this.db.prepare(`
        INSERT INTO devices (name, deviceId, maxBitrate, audioCodec, videoCodec, maxWidth, maxHeight)
        VALUES (?, ?, ?, ?, ?, ?, ?)
      `);

      for (const profile of defaultProfiles) {
        insertStmt.run(
          profile.name,
          profile.deviceId,
          profile.maxBitrate,
          profile.audioCodec,
          profile.videoCodec,
          profile.maxWidth || 1920,
          profile.maxHeight || 1080
        );
      }

      console.log(`Initialized ${defaultProfiles.length} default device profiles`);
    }
  }

  encrypt(text) {
    if (!text) return '';
    const iv = crypto.randomBytes(16);
    const key = Buffer.from(ENCRYPTION_KEY.slice(0, 64), 'hex');
    const cipher = crypto.createCipheriv(ALGORITHM, key, iv);
    let encrypted = cipher.update(text, 'utf8', 'hex');
    encrypted += cipher.final('hex');
    return iv.toString('hex') + ':' + encrypted;
  }

  decrypt(text) {
    if (!text) return '';
    try {
      const parts = text.split(':');
      const iv = Buffer.from(parts[0], 'hex');
      const encryptedText = parts[1];
      const key = Buffer.from(ENCRYPTION_KEY.slice(0, 64), 'hex');
      const decipher = crypto.createDecipheriv(ALGORITHM, key, iv);
      let decrypted = decipher.update(encryptedText, 'hex', 'utf8');
      decrypted += decipher.final('utf8');
      return decrypted;
    } catch (err) {
      console.error('[WARN] Failed to decrypt value (encryption key may have changed):', err.message);
      return '';
    }
  }

  getConfig() {
    const config = this.db.prepare('SELECT * FROM config ORDER BY id DESC LIMIT 1').get();
    if (config && config.apiKey) {
      config.apiKey = this.decrypt(config.apiKey);
    }
    if (config && config.formats) {
      config.formats = JSON.parse(config.formats);
    }
    return config;
  }

  updateConfig(updates) {
    const fields = [];
    const values = [];
    
    for (const [key, value] of Object.entries(updates)) {
      if (!DatabaseManager.CONFIG_FIELDS.has(key)) continue;
      if (key === 'apiKey' && value) {
        fields.push(`${key} = ?`);
        values.push(this.encrypt(value));
      } else if (key === 'formats' && Array.isArray(value)) {
        fields.push(`${key} = ?`);
        values.push(JSON.stringify(value));
      } else {
        fields.push(`${key} = ?`);
        values.push(value);
      }
    }
    
    if (fields.length === 0) return;
    fields.push('updatedAt = CURRENT_TIMESTAMP');
    
    const query = `UPDATE config SET ${fields.join(', ')} WHERE id = 1`;
    return this.db.prepare(query).run(...values);
  }

  getAllDevices() {
    return this.db.prepare('SELECT * FROM devices ORDER BY id').all();
  }

  getDevice(id) {
    return this.db.prepare('SELECT * FROM devices WHERE id = ?').get(id);
  }

  addDevice(device) {
    return this.db.prepare(`
      INSERT INTO devices (name, deviceId, maxBitrate, audioCodec, videoCodec, maxWidth, maxHeight)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(
      device.name,
      device.deviceId,
      device.maxBitrate || 20000000,
      device.audioCodec || 'aac',
      device.videoCodec || 'h264',
      device.maxWidth || 1920,
      device.maxHeight || 1080
    );
  }

  updateDevice(id, updates) {
    const fields = [];
    const values = [];
    
    for (const [key, value] of Object.entries(updates)) {
      if (!DatabaseManager.DEVICE_FIELDS.has(key)) continue;
      fields.push(`${key} = ?`);
      values.push(value);
    }
    
    if (fields.length === 0) return;
    values.push(id);
    const query = `UPDATE devices SET ${fields.join(', ')} WHERE id = ?`;
    return this.db.prepare(query).run(...values);
  }

  deleteDevice(id) {
    return this.db.prepare('DELETE FROM devices WHERE id = ?').run(id);
  }

  addTestResult(test) {
    return this.db.prepare(`
      INSERT INTO tests (testRunId, itemId, itemName, path, deviceId, format, duration, errors, success, bytesDownloaded)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      test.testRunId || null,
      test.itemId,
      test.itemName,
      test.path,
      test.deviceId,
      test.format,
      test.duration,
      test.errors ? JSON.stringify(test.errors) : null,
      test.success ? 1 : 0,
      test.bytesDownloaded || 0
    );
  }

  getTestHistory(limit = 100, offset = 0) {
    return this.db.prepare(`
      SELECT t.*, d.name as deviceName 
      FROM tests t 
      LEFT JOIN devices d ON t.deviceId = d.id 
      ORDER BY t.timestamp DESC 
      LIMIT ? OFFSET ?
    `).all(limit, offset);
  }

  getTestStats() {
    const stats = this.db.prepare(`
      SELECT 
        COUNT(*) as total,
        SUM(CASE WHEN success = 1 THEN 1 ELSE 0 END) as passed,
        SUM(CASE WHEN success = 0 THEN 1 ELSE 0 END) as failed
      FROM tests
    `).get();
    
    return stats;
  }

  updateScanState(lastScanTime, itemsQueued) {
    return this.db.prepare(`
      UPDATE scan_state SET lastScanTime = ?, itemsQueued = ? WHERE id = 1
    `).run(lastScanTime, itemsQueued);
  }

  getScanState() {
    return this.db.prepare('SELECT * FROM scan_state WHERE id = 1').get();
  }

  // Test Run methods for v2.0
  createTestRun(name, config) {
    const result = this.db.prepare(`
      INSERT INTO test_runs (name, status, config, totalTests)
      VALUES (?, 'pending', ?, ?)
    `).run(name, JSON.stringify(config), config.totalTests || 0);
    
    return result.lastInsertRowid;
  }

  getTestRun(id) {
    const run = this.db.prepare('SELECT * FROM test_runs WHERE id = ?').get(id);
    if (run && run.config) {
      run.config = JSON.parse(run.config);
    }
    return run;
  }

  getAllTestRuns(limit = 50) {
    const runs = this.db.prepare(`
      SELECT * FROM test_runs 
      ORDER BY createdAt DESC 
      LIMIT ?
    `).all(limit);
    
    return runs.map(run => {
      if (run.config) run.config = JSON.parse(run.config);
      return run;
    });
  }

  getActiveTestRun() {
    const run = this.db.prepare(`
      SELECT * FROM test_runs 
      WHERE status IN ('running', 'paused') 
      ORDER BY startedAt DESC 
      LIMIT 1
    `).get();
    
    if (run && run.config) {
      run.config = JSON.parse(run.config);
    }
    return run;
  }

  updateTestRun(id, updates) {
    const fields = [];
    const values = [];
    
    for (const [key, value] of Object.entries(updates)) {
      if (!DatabaseManager.TEST_RUN_FIELDS.has(key)) continue;
      if (key === 'config') {
        fields.push(`${key} = ?`);
        values.push(JSON.stringify(value));
      } else {
        fields.push(`${key} = ?`);
        values.push(value);
      }
    }
    
    if (fields.length === 0) return;
    values.push(id);
    const query = `UPDATE test_runs SET ${fields.join(', ')} WHERE id = ?`;
    return this.db.prepare(query).run(...values);
  }

  updateTestRunProgress(id, completed, successful, failed) {
    return this.db.prepare(`
      UPDATE test_runs 
      SET completedTests = ?, successfulTests = ?, failedTests = ?
      WHERE id = ?
    `).run(completed, successful, failed, id);
  }

  getTestRunResults(testRunId) {
    return this.db.prepare(`
      SELECT t.*, d.name as deviceName 
      FROM tests t 
      LEFT JOIN devices d ON t.deviceId = d.id 
      WHERE t.testRunId = ?
      ORDER BY t.timestamp DESC
    `).all(testRunId);
  }

  // --- Scheduled Runs ---
  createScheduledRun(data) {
    const result = this.db.prepare(`
      INSERT INTO scheduled_runs (name, enabled, frequency, dayOfWeek, timeOfDay, deviceIds, libraryIds, mediaScope, mediaDays, testDuration, parallelTests, nextRunAt)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      data.name, data.enabled ? 1 : 0, data.frequency, data.dayOfWeek ?? null,
      data.timeOfDay, JSON.stringify(data.deviceIds), JSON.stringify(data.libraryIds),
      data.mediaScope || 'all', data.mediaDays || 7,
      data.testDuration || 30, data.parallelTests || 2,
      data.nextRunAt || null
    );
    return result.lastInsertRowid;
  }

  getScheduledRun(id) {
    const row = this.db.prepare('SELECT * FROM scheduled_runs WHERE id = ?').get(id);
    return row ? this._parseScheduledRun(row) : null;
  }

  getAllScheduledRuns() {
    return this.db.prepare('SELECT * FROM scheduled_runs ORDER BY createdAt DESC')
      .all().map(r => this._parseScheduledRun(r));
  }

  getEnabledScheduledRuns() {
    return this.db.prepare('SELECT * FROM scheduled_runs WHERE enabled = 1 ORDER BY nextRunAt ASC')
      .all().map(r => this._parseScheduledRun(r));
  }

  updateScheduledRun(id, data) {
    const fields = [];
    const values = [];
    for (const [key, value] of Object.entries(data)) {
      if (!DatabaseManager.SCHEDULE_FIELDS.has(key)) continue;
      if (key === 'deviceIds' || key === 'libraryIds') {
        fields.push(`${key} = ?`);
        values.push(JSON.stringify(value));
      } else if (key === 'enabled') {
        fields.push(`${key} = ?`);
        values.push(value ? 1 : 0);
      } else {
        fields.push(`${key} = ?`);
        values.push(value);
      }
    }
    if (fields.length === 0) return;
    values.push(id);
    this.db.prepare(`UPDATE scheduled_runs SET ${fields.join(', ')} WHERE id = ?`).run(...values);
  }

  deleteScheduledRun(id) {
    this.db.prepare('DELETE FROM scheduled_runs WHERE id = ?').run(id);
  }

  _parseScheduledRun(row) {
    row.deviceIds = JSON.parse(row.deviceIds || '[]');
    row.libraryIds = JSON.parse(row.libraryIds || '[]');
    row.enabled = !!row.enabled;
    return row;
  }

  close() {
    if (this.db) {
      this.db.close();
    }
  }
}

module.exports = DatabaseManager;