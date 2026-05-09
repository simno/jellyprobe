const express = require('express');
const asyncHandler = require('../middleware/asyncHandler');
const validate = require('../middleware/validate');
const { libraryIdParam, libraryItemsQuery, recentItemsQuery, libraryCountQuery } = require('../schemas');

function createLibrariesRouter({ jellyfinClient }) {
  const router = express.Router();

  router.get('/', asyncHandler('Failed to fetch libraries', async (_req, res) => {
    res.json(await jellyfinClient.getLibraries());
  }));

  router.get('/:libraryId/items',
    validate({ params: libraryIdParam, query: libraryItemsQuery }),
    asyncHandler('Failed to fetch library items', async (req, res) => {
      const { libraryId } = req.params;
      const { limit, startIndex, searchTerm = '' } = req.query;
      const result = await jellyfinClient.getLibraryItems(libraryId, limit, startIndex, searchTerm);
      res.json(result);
    })
  );

  router.get('/:libraryId/items/recent',
    validate({ params: libraryIdParam, query: recentItemsQuery }),
    asyncHandler('Failed to fetch recent items', async (req, res) => {
      const { libraryId } = req.params;
      const { days, limit } = req.query;
      const result = await jellyfinClient.getRecentLibraryItems(libraryId, days, limit);
      res.json(result);
    })
  );

  router.get('/:libraryId/count',
    validate({ params: libraryIdParam, query: libraryCountQuery }),
    asyncHandler('Failed to get item count', async (req, res) => {
      const { libraryId } = req.params;
      const { recent, days } = req.query;
      if (recent === 'true') {
        const result = await jellyfinClient.getRecentLibraryItems(libraryId, days, 1);
        return res.json({ count: result.totalCount || 0 });
      }
      const result = await jellyfinClient.getLibraryItems(libraryId, 1, 0);
      res.json({ count: result.totalCount || 0 });
    })
  );

  return router;
}

module.exports = { createLibrariesRouter };
