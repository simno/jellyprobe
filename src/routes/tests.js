const express = require('express');
const asyncHandler = require('../middleware/asyncHandler');
const validate = require('../middleware/validate');
const { paginatedListQuery, testRunBody } = require('../schemas');

function createTestsRouter({ db, testRunner }) {
  const router = express.Router();

  router.get('/',
    validate({ query: paginatedListQuery }),
    asyncHandler('Failed to fetch tests', (req, res) => {
      const { limit, offset } = req.query;
      res.json(db.getTestHistory(limit, offset));
    })
  );

  router.get('/stats', asyncHandler('Failed to fetch test stats', (_req, res) => {
    res.json(db.getTestStats());
  }));

  router.post('/run',
    validate({ body: testRunBody }),
    asyncHandler('Failed to queue test', async (req, res) => {
      const { itemId, deviceId, duration } = req.body;
      await testRunner.queueTest(itemId, deviceId, { duration });
      res.json({ success: true, message: 'Test queued' });
    })
  );

  router.get('/queue', asyncHandler('Failed to get queue status', (_req, res) => {
    res.json(testRunner.getQueueStatus());
  }));

  router.post('/pause', asyncHandler('Failed to pause tests', (_req, res) => {
    testRunner.pause();
    res.json({ success: true });
  }));

  router.post('/resume', asyncHandler('Failed to resume tests', (_req, res) => {
    testRunner.resume();
    res.json({ success: true });
  }));

  router.post('/cancel', asyncHandler('Failed to cancel tests', (_req, res) => {
    testRunner.cancel();
    res.json({ success: true });
  }));

  return router;
}

module.exports = { createTestsRouter };
