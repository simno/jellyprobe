const path = require('path');
const express = require('express');
const pinoHttp = require('pino-http');
const { randomUUID } = require('crypto');

const log = require('./utils/logger');
const { createProxyHandler } = require('./routes/proxy');
const { createSystemRouter } = require('./routes/system');
const { createConfigRouter } = require('./routes/config');
const { createLibrariesRouter } = require('./routes/libraries');
const { createDevicesRouter } = require('./routes/devices');
const { createTestsRouter } = require('./routes/tests');
const { createScanRouter } = require('./routes/scan');
const { createTestRunsRouter } = require('./routes/testRuns');
const { createSchedulesRouter } = require('./routes/schedules');
const { createStreamRouter } = require('./routes/stream');

function securityHeaders(_req, res, next) {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'SAMEORIGIN');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
  res.setHeader('Content-Security-Policy', "default-src 'self'; script-src 'self' https://unpkg.com https://cdn.jsdelivr.net; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self' ws: wss:; media-src 'self' blob:");
  next();
}

function createApp({ db, jellyfinClient, scanner, testRunner, testRunManager, scheduler, broadcast }) {
  const app = express();

  // Request logging with a per-request id. Skip /health and /jf — health is
  // polled noisily and /jf streams binary segments where each line of access
  // log is wasted volume.
  app.use(pinoHttp({
    logger: log.pino,
    genReqId: (req) => req.headers['x-request-id'] || randomUUID(),
    autoLogging: {
      ignore: (req) => req.url === '/health' || req.url.startsWith('/jf/')
    },
    customLogLevel: (_req, res, err) => {
      if (err || res.statusCode >= 500) return 'error';
      if (res.statusCode >= 400) return 'warn';
      return 'info';
    },
    serializers: {
      req: (req) => ({ id: req.id, method: req.method, url: req.url }),
      res: (res) => ({ statusCode: res.statusCode })
    }
  }));

  app.use(securityHeaders);

  // Proxy mounts before body parsing — binary segment bodies must not be consumed.
  app.use('/jf', createProxyHandler({ jellyfinClient }));

  app.use(express.json({ limit: '5mb' }));
  app.use(express.urlencoded({ limit: '5mb', extended: true }));

  app.use(createSystemRouter());
  app.use(express.static(path.join(__dirname, '../public')));

  app.use('/api/config', createConfigRouter({ db, jellyfinClient, scanner, testRunner, broadcast }));
  app.use('/api/libraries', createLibrariesRouter({ jellyfinClient }));
  app.use('/api/devices', createDevicesRouter({ db }));
  app.use('/api/tests', createTestsRouter({ db, testRunner }));
  app.use('/api/scan', createScanRouter({ db, scanner }));
  app.use('/api/test-runs', createTestRunsRouter({ testRunManager }));
  app.use('/api/schedules', createSchedulesRouter({ db, scheduler }));
  app.use('/api/stream', createStreamRouter({ jellyfinClient }));

  return app;
}

module.exports = { createApp };
