const express = require('express');
const asyncHandler = require('../middleware/asyncHandler');
const validate = require('../middleware/validate');
const log = require('../utils/logger');
const { idParam, testRunCreateBody } = require('../schemas');

function createTestRunsRouter({ testRunManager }) {
  const router = express.Router();

  router.post('/',
    validate({ body: testRunCreateBody }),
    asyncHandler('Failed to create test run', (req, res) => {
      const { devices, mediaItems, mediaScope, testConfig, totalTests } = req.body;

      const mediaCount = Array.isArray(mediaItems) ? mediaItems.length : 0;
      let computedTotalTests;
      if (typeof totalTests === 'number' && Number.isFinite(totalTests)) {
        computedTotalTests = totalTests;
      } else if (mediaCount > 0) {
        computedTotalTests = devices.length * mediaCount;
      } else {
        computedTotalTests = undefined;
      }

      const testRun = testRunManager.createTestRun({
        devices,
        mediaItems,
        mediaScope,
        testConfig,
        totalTests: computedTotalTests
      });
      res.json({ success: true, testRun });
    })
  );

  router.get('/', asyncHandler('Failed to fetch test runs', (_req, res) => {
    res.json(testRunManager.getAllTestRuns());
  }));

  router.get('/active', asyncHandler('Failed to fetch active test run', (_req, res) => {
    res.json(testRunManager.getActiveTestRun() || null);
  }));

  router.get('/:id',
    validate({ params: idParam }),
    asyncHandler('Failed to fetch test run', (req, res) => {
      const testRun = testRunManager.getTestRun(req.params.id);
      if (!testRun) return res.status(404).json({ error: 'Test run not found' });
      res.json(testRun);
    })
  );

  router.get('/:id/results',
    validate({ params: idParam }),
    asyncHandler('Failed to fetch test run results', (req, res) => {
      res.json(testRunManager.getTestRunResults(req.params.id));
    })
  );

  router.post('/:id/start',
    validate({ params: idParam }),
    asyncHandler('Failed to start test run', async (req, res) => {
      res.json(await testRunManager.startTestRun(req.params.id));
    })
  );

  router.post('/:id/pause',
    validate({ params: idParam }),
    asyncHandler('Failed to pause test run', (req, res) => {
      testRunManager.pauseTestRun(req.params.id);
      res.json({ success: true });
    })
  );

  router.post('/:id/resume',
    validate({ params: idParam }),
    asyncHandler('Failed to resume test run', (req, res) => {
      testRunManager.resumeTestRun(req.params.id);
      res.json({ success: true });
    })
  );

  router.post('/:id/cancel',
    validate({ params: idParam }),
    asyncHandler('Failed to cancel test run', (req, res) => {
      testRunManager.cancelTestRun(req.params.id);
      res.json({ success: true });
    })
  );

  // Inline catch preserves the user-facing error.message that this endpoint
  // (uniquely) surfaces — rerunTestRun throws messages meant to be displayed.
  router.post('/:id/rerun', validate({ params: idParam }), (req, res) => {
    try {
      const newTestRun = testRunManager.rerunTestRun(req.params.id);
      res.json({ success: true, testRun: newTestRun });
    } catch (error) {
      log.error('POST /api/test-runs/:id/rerun:', error);
      res.status(500).json({ error: error.message || 'Failed to rerun test' });
    }
  });

  return router;
}

module.exports = { createTestRunsRouter };
