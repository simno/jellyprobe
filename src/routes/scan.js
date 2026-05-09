const express = require('express');
const asyncHandler = require('../middleware/asyncHandler');

function createScanRouter({ db, scanner }) {
  const router = express.Router();

  router.post('/trigger', asyncHandler('Failed to trigger scan', (_req, res) => {
    scanner.scan();
    res.json({ success: true });
  }));

  router.get('/status', asyncHandler('Failed to get scan status', (_req, res) => {
    const status = scanner.getStatus();
    const scanState = db.getScanState();
    res.json({ ...status, ...scanState });
  }));

  return router;
}

module.exports = { createScanRouter };
