const path = require('path');
const express = require('express');
const APP_VERSION = require('../../package.json').version;

const VIDEO_CODECS_FILE = path.join(__dirname, '../shared/video-codecs.js');
const PUBLIC_DIR = path.join(__dirname, '../../public');

function createSystemRouter() {
  const router = express.Router();

  router.get('/api/version', (_req, res) => {
    res.json({ version: APP_VERSION });
  });

  router.get('/health', (_req, res) => {
    res.json({
      status: 'healthy',
      timestamp: new Date().toISOString(),
      uptime: process.uptime()
    });
  });

  // Shared codec registry lives under src/ but the browser needs it too —
  // serve it explicitly so the backend doesn't have to reach into public/.
  router.get('/js/video-codecs.js', (_req, res) => {
    res.setHeader('Content-Type', 'application/javascript; charset=utf-8');
    res.sendFile(VIDEO_CODECS_FILE);
  });

  router.get('/', (_req, res) => {
    res.sendFile(path.join(PUBLIC_DIR, 'index.html'));
  });

  return router;
}

module.exports = { createSystemRouter };
