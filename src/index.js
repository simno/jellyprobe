require('dotenv').config();
const express = require('express');
const path = require('path');
const http = require('http');
const axios = require('axios');
const WebSocket = require('ws');
const DatabaseManager = require('./db/schema');
const JellyfinClient = require('./api/jellyfin');
const TestRunner = require('./services/testRunner');
const LibraryScanner = require('./services/scanner');
const TestRunManager = require('./services/testRunManager');
const Scheduler = require('./services/scheduler');

const app = express();
const server = http.createServer(app);
const wss = new WebSocket.Server({ server });

const PORT = process.env.PORT || 3000;
const DATA_PATH = process.env.DATA_PATH || path.join(__dirname, '../data');
const APP_VERSION = require('../package.json').version;

app.use((_req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'SAMEORIGIN');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
  res.setHeader('Content-Security-Policy', "default-src 'self'; script-src 'self' https://unpkg.com https://cdn.jsdelivr.net; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self' ws: wss:; media-src 'self' blob:");
  next();
});

// Jellyfin passthrough proxy — registered before body parser to avoid parsing binary video data
// Only allows /Videos/ and /Audio/ paths to prevent SSRF to other Jellyfin endpoints
const ALLOWED_PROXY_PREFIXES = ['/Videos/', '/Audio/'];

app.use('/jf', async (req, res) => {
  try {
    // SSRF protection: normalize the path to prevent double-encoding and traversal bypasses
    const parsedPath = new URL(req.url, 'http://localhost').pathname;
    const normalizedPath = path.posix.normalize(parsedPath);
    if (!ALLOWED_PROXY_PREFIXES.some(p => normalizedPath.startsWith(p))) {
      return res.status(403).json({ error: 'Forbidden proxy path' });
    }

    const targetUrl = `${jellyfinClient.baseUrl}${req.url}`;
    const upstream = await axios.get(targetUrl, {
      responseType: 'arraybuffer',
      timeout: 30000,
      headers: {
        'X-Emby-Token': jellyfinClient.apiKey,
        ...(req.headers.range ? { Range: req.headers.range } : {})
      }
    });

    const ct = upstream.headers['content-type'] || 'application/octet-stream';
    res.setHeader('Content-Type', ct);
    if (upstream.headers['content-length']) res.setHeader('Content-Length', upstream.headers['content-length']);
    if (upstream.headers['content-range']) res.setHeader('Content-Range', upstream.headers['content-range']);

    if (ct.includes('mpegurl') || ct.includes('x-mpegURL')) {
      let body = Buffer.from(upstream.data).toString('utf-8');
      body = body.replace(/^(\/[^#\s].*$)/gm, '/jf$1');
      res.send(body);
    } else {
      res.status(upstream.status || 200).send(Buffer.from(upstream.data));
    }
  } catch (error) {
    if (!res.headersSent) {
      res.status(error.response?.status || 502).json({ error: 'Proxy request failed' });
    }
  }
});

app.use(express.json({ limit: '5mb' }));
app.use(express.urlencoded({ limit: '5mb', extended: true }));
app.use(express.static(path.join(__dirname, '../public')));

const db = new DatabaseManager(path.join(DATA_PATH, 'jellyprobe.db'));
db.initialize();

const config = db.getConfig();
const jellyfinClient = new JellyfinClient(config?.jellyfinUrl, config?.apiKey);
const testRunner = new TestRunner(jellyfinClient, db);
const scanner = new LibraryScanner(jellyfinClient, db);
const testRunManager = new TestRunManager(db, testRunner, jellyfinClient);
const scheduler = new Scheduler(db, jellyfinClient, testRunManager);

const libraryIds = config?.scanLibraryIds ? JSON.parse(config.scanLibraryIds) : [];
if (config?.jellyfinUrl && config?.apiKey && libraryIds.length > 0) {
  scanner.start();
}

scheduler.start();

if (config?.maxParallelTests) {
  testRunner.setMaxParallelTests(config.maxParallelTests);
}

const clients = new Set();

wss.on('connection', (ws) => {
  clients.add(ws);
  
  ws.on('close', () => {
    clients.delete(ws);
  });
});

function broadcast(event, data) {
  const message = JSON.stringify({ event, data });
  clients.forEach(client => {
    if (client.readyState === WebSocket.OPEN) {
      client.send(message);
    }
  });
}

testRunner.on('testStarted', (data) => broadcast('testStarted', data));
testRunner.on('testProgress', (data) => broadcast('testProgress', data));
testRunner.on('testStreamReady', (data) => broadcast('testStreamReady', data));
testRunner.on('testCompleted', (data) => {
  // Update test run progress if this is part of a test run — do this before broadcasting
  try {
    if (data.testRunId) {
      testRunManager.onTestComplete(data);
    }
  } catch (err) {
    console.error('Error updating test run progress:', err);
  }

  // Broadcast the completion to connected clients; guard against broadcast errors so they don't affect server-side state
  try {
    broadcast('testCompleted', data);
  } catch (err) {
    console.error('Failed to broadcast testCompleted event:', err);
  }
});
testRunner.on('testStreamEnding', (data) => broadcast('testStreamEnding', data));
testRunner.on('bandwidthUpdate', (data) => broadcast('bandwidthUpdate', data));
testRunner.on('queueUpdated', (data) => broadcast('queueUpdated', data));
scanner.on('scanStarted', () => broadcast('scanStarted', {}));
scanner.on('scanCompleted', (data) => broadcast('scanCompleted', data));
scanner.on('scanError', (error) => broadcast('scanError', { error: error.message }));

testRunManager.on('testRunCreated', (data) => broadcast('testRunCreated', data));
testRunManager.on('testRunStarted', (data) => broadcast('testRunStarted', data));
testRunManager.on('testRunPaused', (data) => broadcast('testRunPaused', data));
testRunManager.on('testRunResumed', (data) => broadcast('testRunResumed', data));
testRunManager.on('testRunCancelled', (data) => broadcast('testRunCancelled', data));
testRunManager.on('testRunCompleted', (data) => broadcast('testRunCompleted', data));
testRunManager.on('testRunProgress', (data) => broadcast('testRunProgress', data));
scheduler.on('scheduledRunStarted', (data) => broadcast('scheduledRunStarted', data));

app.get('/api/version', (req, res) => {
  res.json({ version: APP_VERSION });
});

app.get('/api/config', (req, res) => {
  try {
    const config = db.getConfig();
    if (config) {
      config._hasApiKey = !!config.apiKey;
      config.apiKey = config.apiKey ? '••••••••' : '';
    }
    res.json(config);
  } catch (_error) {
    res.status(500).json({ error: 'Failed to load configuration' });
  }
});

app.post('/api/config', async (req, res) => {
  try {
    const updates = req.body;
    if (!updates || typeof updates !== 'object') {
      return res.status(400).json({ error: 'Invalid request body' });
    }
    db.updateConfig(updates);
    
    const newConfig = db.getConfig();
    jellyfinClient.updateConfig(newConfig.jellyfinUrl, newConfig.apiKey);
    
    if (updates.scanInterval !== undefined || updates.scanLibraryId !== undefined) {
      scanner.restart();
    }
    
    broadcast('configUpdated', newConfig);
    res.json({ success: true });
  } catch (_error) {
    res.status(500).json({ error: 'Failed to update configuration' });
  }
});

app.post('/api/config/test', async (req, res) => {
  try {
    const { jellyfinUrl, apiKey } = req.body;
    if (!jellyfinUrl || !apiKey) {
      return res.status(400).json({ success: false, error: 'URL and API key are required' });
    }
    try { new URL(jellyfinUrl); } catch (_e) {
      return res.status(400).json({ success: false, error: 'Invalid URL format' });
    }
    const testClient = new JellyfinClient(jellyfinUrl, apiKey);
    const result = await testClient.testConnection();
    
    if (result.success) {
      jellyfinClient.updateConfig(jellyfinUrl, apiKey);
    }
    
    res.json(result);
  } catch (_error) {
    res.status(500).json({ success: false, error: 'Connection test failed' });
  }
});

app.get('/api/libraries', async (req, res) => {
  try {
    const libraries = await jellyfinClient.getLibraries();
    res.json(libraries);
  } catch (_error) {
    res.status(500).json({ error: 'Failed to fetch libraries' });
  }
});

app.get('/api/libraries/:libraryId/items', async (req, res) => {
  try {
    const { libraryId } = req.params;
    const limit = Math.min(Math.max(parseInt(req.query.limit) || 100, 1), 1000);
    const startIndex = Math.max(parseInt(req.query.startIndex) || 0, 0);
    const searchTerm = (req.query.searchTerm || '').slice(0, 200);
    
    const result = await jellyfinClient.getLibraryItems(libraryId, limit, startIndex, searchTerm);
    res.json(result);
  } catch (_error) {
    res.status(500).json({ error: 'Failed to fetch library items' });
  }
});

app.get('/api/libraries/:libraryId/count', async (req, res) => {
  try {
    const { libraryId } = req.params;
    const recent = req.query.recent === 'true';
    const days = Math.min(Math.max(parseInt(req.query.days) || 7, 1), 365);
    
    if (recent) {
      const result = await jellyfinClient.getRecentLibraryItems(libraryId, days, 1);
      res.json({ count: result.totalCount || 0 });
    } else {
      const result = await jellyfinClient.getLibraryItems(libraryId, 1, 0);
      res.json({ count: result.totalCount || 0 });
    }
  } catch (_error) {
    res.status(500).json({ error: 'Failed to get item count' });
  }
});

app.get('/api/devices', (req, res) => {
  try {
    const devices = db.getAllDevices();
    res.json(devices);
  } catch (_error) {
    res.status(500).json({ error: 'Failed to fetch devices' });
  }
});

app.post('/api/devices', (req, res) => {
  try {
    const device = req.body;
    if (!device || !device.name || !device.deviceId) {
      return res.status(400).json({ error: 'Name and deviceId are required' });
    }
    const result = db.addDevice(device);
    res.json({ success: true, id: result.lastInsertRowid });
  } catch (_error) {
    res.status(500).json({ error: 'Failed to add device' });
  }
});

app.put('/api/devices/:id', (req, res) => {
  try {
    const id = parseInt(req.params.id);
    if (isNaN(id)) return res.status(400).json({ error: 'Invalid device ID' });
    const updates = req.body;
    if (!updates || typeof updates !== 'object') return res.status(400).json({ error: 'Invalid request body' });
    db.updateDevice(id, updates);
    res.json({ success: true });
  } catch (_error) {
    res.status(500).json({ error: 'Failed to update device' });
  }
});

app.delete('/api/devices/:id', (req, res) => {
  try {
    const id = parseInt(req.params.id);
    if (isNaN(id)) return res.status(400).json({ error: 'Invalid device ID' });
    db.deleteDevice(id);
    res.json({ success: true });
  } catch (_error) {
    res.status(500).json({ error: 'Failed to delete device' });
  }
});

app.get('/api/tests', (req, res) => {
  try {
    const limit = Math.min(Math.max(parseInt(req.query.limit) || 100, 1), 1000);
    const offset = Math.max(parseInt(req.query.offset) || 0, 0);
    const tests = db.getTestHistory(limit, offset);
    res.json(tests);
  } catch (_error) {
    res.status(500).json({ error: 'Failed to fetch tests' });
  }
});

app.get('/api/tests/stats', (req, res) => {
  try {
    const stats = db.getTestStats();
    res.json(stats);
  } catch (_error) {
    res.status(500).json({ error: 'Failed to fetch test stats' });
  }
});

app.post('/api/tests/run', async (req, res) => {
  try {
    const { itemId, deviceId, duration } = req.body;
    
    if (!itemId || !deviceId) {
      return res.status(400).json({ error: 'itemId and deviceId are required' });
    }
    
    await testRunner.queueTest(itemId, deviceId, { duration });
    res.json({ success: true, message: 'Test queued' });
  } catch (_error) {
    res.status(500).json({ error: 'Failed to queue test' });
  }
});

app.get('/api/tests/queue', (req, res) => {
  try {
    const status = testRunner.getQueueStatus();
    res.json(status);
  } catch (_error) {
    res.status(500).json({ error: 'Failed to get queue status' });
  }
});

app.post('/api/tests/pause', (req, res) => {
  try {
    testRunner.pause();
    res.json({ success: true });
  } catch (_error) {
    res.status(500).json({ error: 'Failed to pause tests' });
  }
});

app.post('/api/tests/resume', (req, res) => {
  try {
    testRunner.resume();
    res.json({ success: true });
  } catch (_error) {
    res.status(500).json({ error: 'Failed to resume tests' });
  }
});

app.post('/api/tests/cancel', (req, res) => {
  try {
    testRunner.cancel();
    res.json({ success: true });
  } catch (_error) {
    res.status(500).json({ error: 'Failed to cancel tests' });
  }
});

app.post('/api/scan/trigger', async (req, res) => {
  try {
    scanner.scan();
    res.json({ success: true });
  } catch (_error) {
    res.status(500).json({ error: 'Failed to trigger scan' });
  }
});

app.get('/api/scan/status', (req, res) => {
  try {
    const status = scanner.getStatus();
    const scanState = db.getScanState();
    res.json({ ...status, ...scanState });
  } catch (_error) {
    res.status(500).json({ error: 'Failed to get scan status' });
  }
});

app.post('/api/test-runs', (req, res) => {
  try {
    const { devices, mediaItems, mediaScope, testConfig, totalTests } = req.body;

    console.log(`[API] POST /api/test-runs: received mediaScope=${JSON.stringify(mediaScope)}, testConfig=${JSON.stringify(testConfig)}, mediaItems=${Array.isArray(mediaItems) ? mediaItems.length : 'undefined'}`);

    if (!devices || !Array.isArray(devices) || devices.length === 0) {
      return res.status(400).json({ error: 'At least one device is required' });
    }

    if ((!mediaItems || !Array.isArray(mediaItems) || mediaItems.length === 0) && !mediaScope) {
      return res.status(400).json({ error: 'At least one media item or a media scope is required' });
    }

    const devicesCount = Array.isArray(devices) ? devices.length : 0;
    const mediaCount = Array.isArray(mediaItems) ? mediaItems.length : 0;

    let computedTotalTests;
    if (typeof totalTests === 'number' && Number.isFinite(totalTests)) {
      computedTotalTests = totalTests;
    } else if (mediaCount > 0) {
      computedTotalTests = devicesCount * mediaCount;
    } else {
      computedTotalTests = undefined;
    }

    const config = {
      devices,
      mediaItems,
      mediaScope,
      testConfig,
      totalTests: computedTotalTests
    };

    console.log(`[API] Creating test run with config keys: ${Object.keys(config).join(', ')}`);

    const testRun = testRunManager.createTestRun(config);
    res.json({ success: true, testRun });
  } catch (_error) {
    res.status(500).json({ error: 'Failed to create test run' });
  }
});

app.get('/api/test-runs', (req, res) => {
  try {
    const testRuns = testRunManager.getAllTestRuns();
    res.json(testRuns);
  } catch (_error) {
    res.status(500).json({ error: 'Failed to fetch test runs' });
  }
});

app.get('/api/test-runs/active', (req, res) => {
  try {
    const testRun = testRunManager.getActiveTestRun();
    res.json(testRun || null);
  } catch (_error) {
    res.status(500).json({ error: 'Failed to fetch active test run' });
  }
});

app.get('/api/test-runs/:id', (req, res) => {
  try {
    const id = parseInt(req.params.id);
    if (isNaN(id)) return res.status(400).json({ error: 'Invalid test run ID' });
    const testRun = testRunManager.getTestRun(id);
    if (!testRun) {
      return res.status(404).json({ error: 'Test run not found' });
    }
    res.json(testRun);
  } catch (_error) {
    res.status(500).json({ error: 'Failed to fetch test run' });
  }
});

app.get('/api/test-runs/:id/results', (req, res) => {
  try {
    const id = parseInt(req.params.id);
    if (isNaN(id)) return res.status(400).json({ error: 'Invalid test run ID' });
    const results = testRunManager.getTestRunResults(id);
    res.json(results);
  } catch (_error) {
    res.status(500).json({ error: 'Failed to fetch test run results' });
  }
});

app.post('/api/test-runs/:id/start', async (req, res) => {
  try {
    const id = parseInt(req.params.id);
    if (isNaN(id)) return res.status(400).json({ error: 'Invalid test run ID' });
    const result = await testRunManager.startTestRun(id);
    res.json(result);
  } catch (_error) {
    res.status(500).json({ error: 'Failed to start test run' });
  }
});

app.post('/api/test-runs/:id/pause', (req, res) => {
  try {
    const id = parseInt(req.params.id);
    if (isNaN(id)) return res.status(400).json({ error: 'Invalid test run ID' });
    testRunManager.pauseTestRun(id);
    res.json({ success: true });
  } catch (_error) {
    res.status(500).json({ error: 'Failed to pause test run' });
  }
});

app.post('/api/test-runs/:id/resume', (req, res) => {
  try {
    const id = parseInt(req.params.id);
    if (isNaN(id)) return res.status(400).json({ error: 'Invalid test run ID' });
    testRunManager.resumeTestRun(id);
    res.json({ success: true });
  } catch (_error) {
    res.status(500).json({ error: 'Failed to resume test run' });
  }
});

app.post('/api/test-runs/:id/cancel', (req, res) => {
  try {
    const id = parseInt(req.params.id);
    if (isNaN(id)) return res.status(400).json({ error: 'Invalid test run ID' });
    testRunManager.cancelTestRun(id);
    res.json({ success: true });
  } catch (_error) {
    res.status(500).json({ error: 'Failed to cancel test run' });
  }
});

// --- Scheduled Runs ---
app.get('/api/schedules', (req, res) => {
  try {
    const schedules = db.getAllScheduledRuns();
    res.json(schedules);
  } catch (_error) {
    res.status(500).json({ error: 'Failed to fetch schedules' });
  }
});

app.post('/api/schedules', (req, res) => {
  try {
    const data = req.body;
    if (!data || !data.name || !data.frequency || !data.timeOfDay) {
      return res.status(400).json({ error: 'Name, frequency, and timeOfDay are required' });
    }
    data.nextRunAt = Scheduler.computeNextRun(data.frequency, data.dayOfWeek, data.timeOfDay);
    const id = db.createScheduledRun(data);
    res.json({ success: true, id, schedule: db.getScheduledRun(id) });
  } catch (_error) {
    res.status(500).json({ error: 'Failed to create schedule' });
  }
});

app.put('/api/schedules/:id', (req, res) => {
  try {
    const id = parseInt(req.params.id);
    if (isNaN(id)) return res.status(400).json({ error: 'Invalid schedule ID' });
    const data = req.body;
    if (data.frequency || data.dayOfWeek !== undefined || data.timeOfDay) {
      const existing = db.getScheduledRun(id);
      if (!existing) return res.status(404).json({ error: 'Schedule not found' });
      data.nextRunAt = Scheduler.computeNextRun(
        data.frequency || existing.frequency,
        data.dayOfWeek ?? existing.dayOfWeek,
        data.timeOfDay || existing.timeOfDay
      );
    }
    db.updateScheduledRun(id, data);
    res.json({ success: true, schedule: db.getScheduledRun(id) });
  } catch (_error) {
    res.status(500).json({ error: 'Failed to update schedule' });
  }
});

app.delete('/api/schedules/:id', (req, res) => {
  try {
    const id = parseInt(req.params.id);
    if (isNaN(id)) return res.status(400).json({ error: 'Invalid schedule ID' });
    db.deleteScheduledRun(id);
    res.json({ success: true });
  } catch (_error) {
    res.status(500).json({ error: 'Failed to delete schedule' });
  }
});

app.post('/api/schedules/:id/run', async (req, res) => {
  try {
    const id = parseInt(req.params.id);
    if (isNaN(id)) return res.status(400).json({ error: 'Invalid schedule ID' });
    const schedule = db.getScheduledRun(id);
    if (!schedule) return res.status(404).json({ error: 'Schedule not found' });
    await scheduler.executeSchedule(schedule);
    res.json({ success: true });
  } catch (_error) {
    res.status(500).json({ error: 'Failed to run schedule' });
  }
});

app.get('/api/libraries/:id/items/recent', async (req, res) => {
  try {
    const libraryId = req.params.id;
    const days = Math.min(Math.max(parseInt(req.query.days) || 7, 1), 365);
    const limit = Math.min(Math.max(parseInt(req.query.limit) || 1000, 1), 10000);
    
    const result = await jellyfinClient.getRecentLibraryItems(libraryId, days, limit);
    res.json(result);
  } catch (_error) {
    res.status(500).json({ error: 'Failed to fetch recent items' });
  }
});

// HLS stream entry point: fetches master.m3u8 and rewrites URLs to go through /jf/
app.get('/api/stream/:itemId', async (req, res) => {
  try {
    const { itemId } = req.params;
    const { mediaSourceId, deviceId, playSessionId, videoCodec, audioCodec, maxBitrate, maxWidth, maxHeight } = req.query;

    if (!mediaSourceId || !deviceId) {
      return res.status(400).json({ error: 'mediaSourceId and deviceId are required' });
    }

    const masterUrl = jellyfinClient.getStreamUrl(itemId, mediaSourceId, deviceId, {
      playSessionId: playSessionId || '',
      videoCodec: videoCodec || 'h264',
      audioCodec: audioCodec || 'aac',
      maxBitrate: Math.min(parseInt(maxBitrate) || 20000000, 100000000),
      maxWidth: Math.min(parseInt(maxWidth) || 1920, 3840),
      maxHeight: Math.min(parseInt(maxHeight) || 1080, 2160)
    });

    const upstream = await axios.get(masterUrl, {
      timeout: 30000,
      headers: { 'X-Emby-Token': jellyfinClient.apiKey }
    });

    // Resolve relative URLs against the master URL's directory, then prefix with /jf
    const masterDir = new URL(masterUrl).pathname.replace(/[^/]*$/, '');
    let body = upstream.data;
    if (typeof body === 'string') {
      body = body.replace(/(^[^#\s].*$)/gm, (line) => {
        if (line.startsWith('http')) return line;
        if (line.startsWith('/')) return `/jf${line}`;
        return `/jf${masterDir}${line}`;
      });
    }

    res.setHeader('Content-Type', upstream.headers['content-type'] || 'application/vnd.apple.mpegurl');
    res.send(body);
  } catch (_error) {
    if (!res.headersSent) {
      res.status(502).json({ error: 'Stream proxy failed' });
    }
  }
});

app.get('/health', (req, res) => {
  res.json({ 
    status: 'healthy', 
    timestamp: new Date().toISOString(),
    uptime: process.uptime()
  });
});

app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, '../public/index.html'));
});

let isShuttingDown = false;

async function gracefulShutdown(signal) {
  if (isShuttingDown) return;
  isShuttingDown = true;
  console.log(`${signal} received, shutting down gracefully...`);

  // 1. Stop accepting new work and await in-flight test cleanup (including stopPlayback calls)
  await testRunner.stop();
  scheduler.stop();
  scanner.stop();

  // 2. Close HTTP server (stops new connections), then close DB last
  server.close(() => {
    console.log('Server closed');
    db.close();
    process.exit(0);
  });

  // Force exit if server.close hangs
  setTimeout(() => {
    console.error('Shutdown timed out, forcing exit');
    db.close();
    process.exit(1);
  }, 10000);
}

process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
process.on('SIGINT', () => gracefulShutdown('SIGINT'));

server.listen(PORT, () => {
  console.log(`JellyProbe server running on port ${PORT}`);
  console.log(`Dashboard: http://localhost:${PORT}`);
  console.log(`Health check: http://localhost:${PORT}/health`);
});
