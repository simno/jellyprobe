require('dotenv').config();
const path = require('path');
const http = require('http');

const DatabaseManager = require('./db/schema');
const JellyfinClient = require('./api/jellyfin');
const TestRunner = require('./services/testRunner');
const LibraryScanner = require('./services/scanner');
const TestRunManager = require('./services/testRunManager');
const Scheduler = require('./services/scheduler');
const log = require('./utils/logger');
const { createBroadcaster } = require('./ws');
const { createApp } = require('./app');

const PORT = process.env.PORT || 3000;
const DATA_PATH = process.env.DATA_PATH || path.join(__dirname, '../data');

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

// Recover any test runs left in a non-terminal state from a previous process
// (e.g. server restart while a run was active). Without this, the history view
// shows them as 'running' forever.
try {
  const orphans = db.cancelOrphanedTestRuns();
  for (const r of orphans) {
    log.info(`[Startup] Recovered orphaned test run ${r.id} (was ${r.status}) → cancelled`);
  }
} catch (err) {
  log.error('[Startup] Failed to recover orphaned test runs:', err.message);
}

scheduler.start();

if (config?.maxParallelTests) {
  testRunner.setMaxParallelTests(config.maxParallelTests);
}

const server = http.createServer();
const { broadcast, forwardEvents } = createBroadcaster(server);

forwardEvents(testRunner, [
  'testStarted',
  'testProgress',
  'testStreamReady',
  'testStreamEnding',
  'bandwidthUpdate',
  'queueUpdated'
]);

// testCompleted needs to update the test-run aggregate before broadcasting.
testRunner.on('testCompleted', (data) => {
  try {
    if (data.testRunId) {
      testRunManager.onTestComplete(data);
    }
  } catch (err) {
    log.error('Error updating test run progress:', err);
  }

  try {
    broadcast('testCompleted', data);
  } catch (err) {
    log.error('Failed to broadcast testCompleted event:', err);
  }
});

forwardEvents(scanner, ['scanStarted', 'scanCompleted']);
scanner.on('scanError', (error) => broadcast('scanError', { error: error.message }));

forwardEvents(testRunManager, [
  'testRunCreated',
  'testRunStarted',
  'testRunPaused',
  'testRunResumed',
  'testRunCancelled',
  'testRunCompleted',
  'testRunProgress'
]);
forwardEvents(scheduler, ['scheduledRunStarted']);

const app = createApp({
  db,
  jellyfinClient,
  scanner,
  testRunner,
  testRunManager,
  scheduler,
  broadcast
});

server.on('request', app);

let isShuttingDown = false;

async function gracefulShutdown(signal) {
  if (isShuttingDown) return;
  isShuttingDown = true;
  log.info(`${signal} received, shutting down gracefully...`);

  await testRunner.stop();
  scheduler.stop();
  scanner.stop();

  const forceExit = setTimeout(() => {
    log.error('Shutdown timed out, forcing exit');
    db.close();
    process.exit(1);
  }, 10000);

  server.close(() => {
    clearTimeout(forceExit);
    log.info('Server closed');
    db.close();
    process.exit(0);
  });
}

process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
process.on('SIGINT', () => gracefulShutdown('SIGINT'));

server.listen(PORT, () => {
  log.info(`JellyProbe server running on port ${PORT}`);
  log.info(`Dashboard: http://localhost:${PORT}`);
  log.info(`Health check: http://localhost:${PORT}/health`);
});
