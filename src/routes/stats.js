const express = require('express');
const asyncHandler = require('../middleware/asyncHandler');

// Aggregates everything the Home dashboard needs into a single call: Jellyfin
// server health, per-library item counts, and rolled-up test-run history. Each
// piece degrades independently — if Jellyfin is unreachable we still return the
// locally-known run stats rather than failing the whole request.
function createStatsRouter({ db, jellyfinClient }) {
  const router = express.Router();

  router.get('/', asyncHandler('Failed to load stats', async (_req, res) => {
    const config = db.getConfig();
    const configuredLibIds = config?.scanLibraryIds
      ? JSON.parse(config.scanLibraryIds)
      : [];

    // --- Jellyfin server health ---
    let server;
    try {
      const conn = await jellyfinClient.testConnection();
      server = conn.success
        ? { online: true, name: conn.serverName, version: conn.version, url: config?.jellyfinUrl }
        : { online: false, error: conn.error };
    } catch (e) {
      server = { online: false, error: e.message };
    }

    // --- Library item counts ---
    let libraries = [];
    let totalItems = 0;
    if (server.online) {
      try {
        const allLibs = await jellyfinClient.getLibraries();
        const wanted = configuredLibIds.length
          ? allLibs.filter(l => configuredLibIds.includes(l.ItemId || l.Id))
          : allLibs;

        libraries = await Promise.all(wanted.map(async (lib) => {
          const id = lib.ItemId || lib.Id;
          let count = 0;
          try {
            const r = await jellyfinClient.getLibraryItems(id, 1, 0);
            count = r.totalCount || 0;
          } catch (_e) { /* leave count at 0 */ }
          totalItems += count;
          return { id, name: lib.Name, type: lib.CollectionType || 'mixed', count };
        }));
      } catch (_e) { /* leave libraries empty */ }
    }

    // --- Test-run history ---
    const testStats = db.getTestStats(); // { total, passed, failed } across all tests
    const totalRuns = db.getTestRunCount();
    const recentRuns = db.getAllTestRuns(5);
    const lastRun = recentRuns[0] || null;
    const passed = testStats.passed || 0;
    const failed = testStats.failed || 0;
    const testsRun = testStats.total || 0;
    const passRate = testsRun > 0 ? Math.round((passed / testsRun) * 100) : null;

    const activeRun = db.getActiveTestRun() || null;

    res.json({
      server,
      libraries,
      totalItems,
      runs: {
        total: totalRuns,
        testsRun,
        passed,
        failed,
        passRate,
        lastRunAt: lastRun ? (lastRun.completedAt || lastRun.createdAt) : null,
        recent: recentRuns
      },
      activeRun,
      devicesConfigured: db.getAllDevices().length,
      librariesConfigured: configuredLibIds.length
    });
  }));

  return router;
}

module.exports = { createStatsRouter };
