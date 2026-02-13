const DatabaseManager = require('../../src/db/schema');
const fs = require('fs');
const path = require('path');

describe('DatabaseManager', () => {
  let db;
  const testDbPath = path.join(__dirname, 'test.db');

  beforeEach(() => {
    if (fs.existsSync(testDbPath)) {
      fs.unlinkSync(testDbPath);
    }
    db = new DatabaseManager(testDbPath);
    db.initialize();
  });

  afterEach(() => {
    if (db) {
      db.close();
    }
    if (fs.existsSync(testDbPath)) {
      fs.unlinkSync(testDbPath);
    }
  });

  describe('initialization', () => {
    test('should create database file', () => {
      expect(fs.existsSync(testDbPath)).toBe(true);
    });

    test('should create all required tables', () => {
      const tables = db.db.prepare(`
        SELECT name FROM sqlite_master WHERE type='table'
      `).all();

      const tableNames = tables.map(t => t.name);
      expect(tableNames).toContain('config');
      expect(tableNames).toContain('devices');
      expect(tableNames).toContain('tests');
      expect(tableNames).toContain('scan_state');
    });

    test('should seed default config', () => {
      const config = db.getConfig();
      expect(config).toBeDefined();
      expect(config.jellyfinUrl).toBeDefined();
    });

    test('should seed default devices', () => {
      const devices = db.getAllDevices();
      expect(devices.length).toBe(4);
      expect(devices[0].name).toBe('720p H.264');
      // Verify codec variety
      const codecs = devices.map(d => d.videoCodec);
      expect(codecs).toContain('h264');
      expect(codecs).toContain('hevc');
      expect(codecs).toContain('av1');
    });
  });

  describe('config operations', () => {
    test('should get config', () => {
      const config = db.getConfig();
      expect(config).toHaveProperty('jellyfinUrl');
      expect(config).toHaveProperty('apiKey');
      expect(config).toHaveProperty('scanInterval');
    });

    test('should update config', () => {
      db.updateConfig({
        jellyfinUrl: 'http://test:8096',
        scanInterval: 600
      });

      const config = db.getConfig();
      expect(config.jellyfinUrl).toBe('http://test:8096');
      expect(config.scanInterval).toBe(600);
    });

    test('should encrypt API key', () => {
      const testKey = 'test-api-key-12345';
      db.updateConfig({ apiKey: testKey });

      const rawData = db.db.prepare(
        'SELECT apiKey FROM config WHERE id = 1'
      ).get();

      expect(rawData.apiKey).not.toBe(testKey);
      expect(rawData.apiKey).toContain(':');

      const config = db.getConfig();
      expect(config.apiKey).toBe(testKey);
    });

    test('should parse formats as JSON array', () => {
      db.updateConfig({ formats: ['mp4', 'mkv', 'avi'] });
      
      const config = db.getConfig();
      expect(Array.isArray(config.formats)).toBe(true);
      expect(config.formats).toEqual(['mp4', 'mkv', 'avi']);
    });
  });

  describe('device operations', () => {
    test('should add device', () => {
      const result = db.addDevice({
        name: 'Test Device',
        deviceId: 'test-123',
        maxBitrate: 10000000,
        audioCodec: 'mp3',
        videoCodec: 'h264',
        hwAcceleration: true
      });

      expect(result.lastInsertRowid).toBeGreaterThan(0);
    });

    test('should get all devices', () => {
      db.addDevice({
        name: 'Device 1',
        deviceId: 'dev-1',
        maxBitrate: 10000000
      });
      
      db.addDevice({
        name: 'Device 2',
        deviceId: 'dev-2',
        maxBitrate: 20000000
      });

      const devices = db.getAllDevices();
      expect(devices.length).toBeGreaterThanOrEqual(3); // Including default
    });

    test('should get device by id', () => {
      const result = db.addDevice({
        name: 'Test Device',
        deviceId: 'test-456',
        maxBitrate: 15000000
      });

      const device = db.getDevice(result.lastInsertRowid);
      expect(device.name).toBe('Test Device');
      expect(device.deviceId).toBe('test-456');
    });

    test('should update device', () => {
      const result = db.addDevice({
        name: 'Old Name',
        deviceId: 'dev-789',
        maxBitrate: 10000000
      });

      db.updateDevice(result.lastInsertRowid, {
        name: 'New Name',
        maxBitrate: 30000000
      });

      const device = db.getDevice(result.lastInsertRowid);
      expect(device.name).toBe('New Name');
      expect(device.maxBitrate).toBe(30000000);
    });

    test('should delete device', () => {
      const result = db.addDevice({
        name: 'Delete Me',
        deviceId: 'del-123',
        maxBitrate: 10000000
      });

      db.deleteDevice(result.lastInsertRowid);
      
      const device = db.getDevice(result.lastInsertRowid);
      expect(device).toBeUndefined();
    });
  });

  describe('test operations', () => {
    test('should add test result', () => {
      const device = db.addDevice({
        name: 'Test Device',
        deviceId: 'test-dev',
        maxBitrate: 10000000
      });

      const result = db.addTestResult({
        itemId: 'item-123',
        itemName: 'Test Movie',
        path: '/media/test.mp4',
        deviceId: device.lastInsertRowid,
        format: 'mp4',
        duration: 30,
        errors: null,
        success: true
      });

      expect(result.lastInsertRowid).toBeGreaterThan(0);
    });

    test('should get test history', async () => {
      const device = db.addDevice({
        name: 'Test Device',
        deviceId: 'test-dev',
        maxBitrate: 10000000
      });

      db.addTestResult({
        itemId: 'item-1',
        itemName: 'Movie 1',
        path: '/media/movie1.mp4',
        deviceId: device.lastInsertRowid,
        format: 'mp4',
        duration: 30,
        success: true
      });

      // Manually set an older timestamp for item-1 to ensure item-2 is "newer"
      db.db.prepare("UPDATE tests SET timestamp = datetime('now', '-1 minute') WHERE itemId = 'item-1'").run();
      
      db.addTestResult({
        itemId: 'item-2',
        itemName: 'Movie 2',
        path: '/media/movie2.mkv',
        deviceId: device.lastInsertRowid,
        format: 'mkv',
        duration: 45,
        success: false
      });

      const history = db.getTestHistory(10, 0);
      expect(history.length).toBe(2);
      // Verify both items are present
      const itemIds = history.map(h => h.itemId);
      expect(itemIds).toContain('item-1');
      expect(itemIds).toContain('item-2');
      // The newest should be first
      expect(history[0].itemId).toBe('item-2');
    });

    test('should get test stats', () => {
      const device = db.addDevice({
        name: 'Test Device',
        deviceId: 'test-dev',
        maxBitrate: 10000000
      });

      // 0,1,2,3,4,5,6,7,8,9 -> failures at 0,3,6,9 = 4 failures, 6 passes
      for (let i = 0; i < 10; i++) {
        db.addTestResult({
          itemId: `item-${i}`,
          itemName: `Movie ${i}`,
          deviceId: device.lastInsertRowid,
          format: 'mp4',
          duration: 30,
          success: i % 3 !== 0 // i%3!==0: true for 1,2,4,5,7,8 (6 true)
        });
      }

      const stats = db.getTestStats();
      expect(stats.total).toBe(10);
      expect(stats.passed).toBe(6);
      expect(stats.failed).toBe(4);
    });

    test('should store error details as JSON', () => {
      const device = db.addDevice({
        name: 'Test Device',
        deviceId: 'test-dev',
        maxBitrate: 10000000
      });

      const errors = ['Error 1', 'Error 2'];
      db.addTestResult({
        itemId: 'item-err',
        itemName: 'Error Movie',
        deviceId: device.lastInsertRowid,
        format: 'mp4',
        duration: 10,
        errors: errors,
        success: false
      });

      const history = db.getTestHistory(1, 0);
      const parsedErrors = JSON.parse(history[0].errors);
      expect(parsedErrors).toEqual(errors);
    });
  });

  describe('scan state operations', () => {
    test('should update scan state', () => {
      const timestamp = new Date().toISOString();
      db.updateScanState(timestamp, 5);

      const state = db.getScanState();
      expect(state.lastScanTime).toBe(timestamp);
      expect(state.itemsQueued).toBe(5);
    });

    test('should get scan state', () => {
      const state = db.getScanState();
      expect(state).toBeDefined();
      expect(state).toHaveProperty('lastScanTime');
      expect(state).toHaveProperty('itemsQueued');
    });
  });

  describe('encryption', () => {
    test('should encrypt and decrypt text', () => {
      const plaintext = 'secret-api-key-123';
      const encrypted = db.encrypt(plaintext);
      const decrypted = db.decrypt(encrypted);

      expect(encrypted).not.toBe(plaintext);
      expect(decrypted).toBe(plaintext);
    });

    test('should handle empty strings', () => {
      const encrypted = db.encrypt('');
      const decrypted = db.decrypt('');

      expect(encrypted).toBe('');
      expect(decrypted).toBe('');
    });
  });
});
