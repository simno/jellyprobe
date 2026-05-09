const express = require('express');
const asyncHandler = require('../middleware/asyncHandler');
const validate = require('../middleware/validate');
const log = require('../utils/logger');
const JellyfinClient = require('../api/jellyfin');
const { configUpdateBody, configTestBody } = require('../schemas');

function createConfigRouter({ db, jellyfinClient, scanner, testRunner, broadcast }) {
  const router = express.Router();

  router.get('/', asyncHandler('Failed to load configuration', (_req, res) => {
    const config = db.getConfig();
    if (config) {
      config._hasApiKey = !!config.apiKey;
      config.apiKey = config.apiKey ? '••••••••' : '';
    }
    res.json(config);
  }));

  router.post('/',
    validate({ body: configUpdateBody }),
    asyncHandler('Failed to update configuration', async (req, res) => {
      const updates = req.body;
      db.updateConfig(updates);

      const newConfig = db.getConfig();
      jellyfinClient.updateConfig(newConfig.jellyfinUrl, newConfig.apiKey);

      if (updates.scanInterval !== undefined || updates.scanLibraryId !== undefined) {
        scanner.restart();
      }

      if (updates.maxParallelTests !== undefined && newConfig.maxParallelTests) {
        testRunner.setMaxParallelTests(newConfig.maxParallelTests);
      }

      broadcast('configUpdated', newConfig);
      res.json({ success: true });
    })
  );

  // Inline try/catch preserves the {success: false, error} shape on failure.
  router.post('/test', validate({ body: configTestBody }), async (req, res) => {
    try {
      const { jellyfinUrl, apiKey } = req.body;
      const testClient = new JellyfinClient(jellyfinUrl, apiKey);
      const result = await testClient.testConnection();
      if (result.success) {
        jellyfinClient.updateConfig(jellyfinUrl, apiKey);
      }
      res.json(result);
    } catch (err) {
      log.error('POST /api/config/test:', err);
      res.status(500).json({ success: false, error: 'Connection test failed' });
    }
  });

  return router;
}

module.exports = { createConfigRouter };
