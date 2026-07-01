const EventEmitter = require('events');
const log = require('../utils/logger');

class TestRunManager extends EventEmitter {
  constructor(db, testRunner, jellyfinClient) {
    super();
    this.db = db;
    this.testRunner = testRunner;
    this.jellyfinClient = jellyfinClient;
    this.currentRunId = null;
    // Run ids whose media items are still being fetched/queued. While a run
    // is in here its totalTests is only an estimate (possibly 0), so test
    // completions must not be allowed to finalize it.
    this._queueingRuns = new Set();
    // Run ids cancelled in this process — checked while queueing so a
    // cancelled run doesn't keep adding tests from in-flight batch fetches.
    this._cancelledRuns = new Set();
  }

  generateTestRunName() {
    const date = new Date();
    const dateStr = date.toISOString().split('T')[0];
    const timeStr = date.toTimeString().split(' ')[0].slice(0, 5);
    return `Test Run ${dateStr} ${timeStr}`;
  }

  createTestRun(config, name) {
    if (!name) name = this.generateTestRunName();
    
    // Config now supports:
    // { devices, mediaScope: { type: 'all'|'recent'|'custom', libraryIds, days, itemIds }, testConfig }
    const runId = this.db.createTestRun(name, config);
    
    this.emit('testRunCreated', { id: runId, name, config });
    return { 
      id: runId, 
      name, 
      totalTests: config.totalTests || 0,
      completedTests: 0,
      successfulTests: 0,
      failedTests: 0
    };
  }

  async startTestRun(runId, options = {}) {
    const testRun = this.db.getTestRun(runId);
    if (!testRun) {
      throw new Error('Test run not found');
    }

    if (testRun.status !== 'pending') {
      throw new Error('Test run is not in pending state');
    }

    this.currentRunId = runId;
    this._cancelledRuns.delete(runId);

    // Clear any leftover items from a previous run
    this.testRunner.clearQueue();

    this.db.updateTestRun(runId, {
      status: 'running',
      startedAt: new Date().toISOString()
    });

    const maxParallel = options.maxParallelTests || this.db.getConfig()?.maxParallelTests;
    if (maxParallel) {
      this.testRunner.setMaxParallelTests(maxParallel);
      log.info(`Set maxParallelTests to ${maxParallel}`);
    }

    const scope = testRun.config.mediaScope;
    const { devices, testConfig, mediaItems } = testRun.config;

    log.info(`[TestRunManager] Starting test run ${runId}:`);
    log.info(`  - testRun.config keys: ${Object.keys(testRun.config).join(', ')}`);
    log.info(`  - scope: ${JSON.stringify(scope)}`);
    log.info(`  - testConfig: ${JSON.stringify(testConfig)}`);
    log.info(`  - mediaItems: ${Array.isArray(mediaItems) ? mediaItems.length + ' items' : 'undefined/null'}`);

    try {
      this.emit('testRunStarted', { id: runId });

      // Fetch and queue media items in batches — processing starts as items arrive
      this._queueingRuns.add(runId);
      this._queueMediaItemsInBatches(runId, devices, scope, testConfig || {})
        .then(() => {
          this._queueingRuns.delete(runId);
          // All tests may already have completed while queueing was still in
          // flight — finalize now, since no further completions will arrive.
          this._maybeCompleteRun(runId);
        })
        .catch(err => {
          this._queueingRuns.delete(runId);
          log.error(`Failed to queue media items for test run ${runId}:`, err.message);
          // Don't leave the run stuck in 'running' — mark as failed so the
          // history view reflects the terminal state. Persist the reason so the
          // UI can distinguish a fetch failure from a genuinely empty library.
          try {
            this.db.updateTestRun(runId, {
              status: 'failed',
              error: err.message,
              completedAt: new Date().toISOString()
            });
          } catch (updateErr) {
            log.error(`Failed to mark run ${runId} as failed:`, updateErr.message);
          }
          if (this.currentRunId === runId) this.currentRunId = null;
          this.emit('testRunError', { id: runId, error: err.message });
          this.emit('testRunCompleted', { id: runId });
        });

    } catch (err) {
      log.error(`Failed to start test run ${runId}:`, err.message);
      this.db.updateTestRun(runId, { status: 'failed', error: err.message, completedAt: new Date().toISOString() });
      this.emit('testRunError', { id: runId, error: err.message });
      throw err;
    }

    return { success: true };
  }

  // Retry a Jellyfin fetch with exponential backoff. Scheduled runs often fire
  // when the server is briefly unavailable (e.g. a 05:00 restart/backup window);
  // without this, one transient blip fails the whole run. This runs detached
  // from the scheduler tick, so the total wait (~30s) doesn't block scheduling.
  async _withRetry(fn, label) {
    const MAX_ATTEMPTS = 5;
    let lastErr;
    for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
      try {
        return await fn();
      } catch (err) {
        lastErr = err;
        if (attempt === MAX_ATTEMPTS) break;
        const delay = Math.min(30000, 2000 * 2 ** (attempt - 1));
        log.warn(`[TestRunManager] ${label} failed (attempt ${attempt}/${MAX_ATTEMPTS}): ${err.message} — retrying in ${delay}ms`);
        await new Promise(resolve => setTimeout(resolve, delay));
      }
    }
    throw lastErr;
  }

  async _queueMediaItemsInBatches(runId, devices, scope, testConfig) {
    const BATCH_SIZE = 100;
    let totalQueued = 0;

    // The run can be cancelled while batches are still being fetched. Without
    // this check the loop would keep queueing tests and re-triggering
    // processQueue(), effectively resurrecting a cancelled run.
    const runIsActive = () => !this._cancelledRuns.has(runId);

    try {
      log.info(`[TestRunManager] Queueing media: scope=${JSON.stringify(scope)}, devices=${devices.length}`);

      if (scope && scope.type === 'all') {
        for (const libId of scope.libraryIds) {
          let start = 0, hasMore = true;
          while (hasMore && runIsActive()) {
            const r = await this._withRetry(
              () => this.jellyfinClient.getLibraryItems(libId, BATCH_SIZE, start),
              `getLibraryItems(lib=${libId}, start=${start})`
            );
            if (r.items && r.items.length > 0) {
              totalQueued += this._queueTestBatch(runId, devices, r.items, testConfig);
              this.testRunner.processQueue();
              start += r.items.length;
              hasMore = r.totalCount > start;
            } else {
              hasMore = false;
            }
          }
        }
      } else if (scope && scope.type === 'recent') {
        const days = scope.days || 7;
        // If itemIds were pinned at launch, use them to filter the bulk
        // fetch so the run tests exactly what the user previewed.
        const pinnedIds = Array.isArray(scope.itemIds) && scope.itemIds.length > 0
          ? new Set(scope.itemIds) : null;
        for (const libId of scope.libraryIds) {
          if (!runIsActive()) break;
          const r = await this._withRetry(
            () => this.jellyfinClient.getRecentLibraryItems(libId, days, 10000),
            `getRecentLibraryItems(lib=${libId}, days=${days})`
          );
          if (r.items && r.items.length > 0) {
            const items = pinnedIds ? r.items.filter(i => pinnedIds.has(i.Id)) : r.items;
            if (items.length > 0) {
              totalQueued += this._queueTestBatch(runId, devices, items, testConfig);
              this.testRunner.processQueue();
            }
          }
        }
      } else if (scope && scope.type === 'custom' && scope.itemIds) {
        const items = [];
        for (const itemId of scope.itemIds) {
          if (!runIsActive()) break;
          try {
            const item = await this._withRetry(
              () => this.jellyfinClient.getItem(itemId),
              `getItem(${itemId})`
            );
            if (item) items.push(item);
          } catch (e) {
            log.warn(`[TestRunManager] Failed to fetch item ${itemId}: ${e.message}`);
          }
        }
        if (items.length > 0) {
          totalQueued += this._queueTestBatch(runId, devices, items, testConfig);
          this.testRunner.processQueue();
        }
      }

      // Fallback: use mediaItems from config (legacy / no scope)
      if (totalQueued === 0) {
        const testRun = this.db.getTestRun(runId);
        if (testRun && testRun.config.mediaItems && testRun.config.mediaItems.length > 0) {
          log.info(`[TestRunManager] Using mediaItems fallback: ${testRun.config.mediaItems.length} items`);
          totalQueued += this._queueTestBatch(runId, devices, testRun.config.mediaItems, testConfig);
          this.testRunner.processQueue();
        } else {
          log.warn(`[TestRunManager] No items resolved for run ${runId} (scope=${JSON.stringify(scope)})`);
        }
      }

      log.info(`[TestRunManager] Total queued tests: ${totalQueued}`);

      // Run was cancelled while queueing — leave its terminal status alone.
      if (!runIsActive()) return;

      // If no media items were found, complete the run immediately
      if (totalQueued === 0) {
        log.info(`[TestRunManager] No media to process for run ${runId}, marking as completed`);
        this.db.updateTestRun(runId, {
          status: 'completed',
          totalTests: 0,
          completedAt: new Date().toISOString()
        });
        this.emit('testRunCompleted', { id: runId });
        if (this.currentRunId === runId) {
          this.currentRunId = null;
        }
        return;
      }

      // Correct totalTests if the actual count differs from the estimate
      const testRun = this.db.getTestRun(runId);
      if (totalQueued !== testRun.totalTests) {
        this.db.updateTestRun(runId, { totalTests: totalQueued });
      }
    } catch (err) {
      log.error(`[TestRunManager] Error queuing media for run ${runId}: ${err.message}`);
      throw err;
    }
  }

  _queueTestBatch(runId, devices, items, testConfig) {
    // Never queue tests for a run that was cancelled while its media was
    // still being fetched.
    if (this._cancelledRuns.has(runId)) return 0;

    // Ensure testConfig is an object so accessing properties is safe
    testConfig = testConfig || {};

    // Build per-device queues with independently shuffled item orders,
    // then interleave round-robin so parallel tests hit different items.
    const perDevice = devices.map(device => {
      const deviceTests = items.map(item => {
        let itemName = item.Name;
        if (item.Type === 'Episode' && item.SeriesName) {
          const season = item.ParentIndexNumber ? `S${item.ParentIndexNumber}` : '';
          const episode = item.IndexNumber ? `E${item.IndexNumber}` : '';
          const episodeNum = season || episode ? ` ${season}${episode}` : '';
          itemName = `${item.SeriesName}${episodeNum} - ${item.Name}`;
        }

        return {
          testRunId: runId,
          itemId: item.Id,
          itemName: itemName,
          path: item.Path,
          container: item.Container || '',
          deviceId: device.id,
          deviceName: device.name,
          deviceConfig: {
            deviceId: device.deviceId,
            maxBitrate: device.maxBitrate,
            audioCodec: device.audioCodec,
            videoCodec: device.videoCodec,
            maxWidth: device.maxWidth,
            maxHeight: device.maxHeight
          },
          testConfig: {
            duration: testConfig.duration || undefined
          }
        };
      });

      for (let i = deviceTests.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [deviceTests[i], deviceTests[j]] = [deviceTests[j], deviceTests[i]];
      }
      return deviceTests;
    });

    // Interleave: round-robin across devices so consecutive tests use different items
    const tests = [];
    const maxLen = Math.max(...perDevice.map(q => q.length));
    for (let i = 0; i < maxLen; i++) {
      for (const queue of perDevice) {
        if (i < queue.length) tests.push(queue[i]);
      }
    }

    for (const t of tests) {
      this.testRunner.addTestToQueue(t);
    }


    return tests.length;
  }

  pauseTestRun(runId) {
    if (this.currentRunId !== runId) {
      throw new Error('Test run is not currently running');
    }

    this.testRunner.pause();
    this.db.updateTestRun(runId, { status: 'paused' });
    this.emit('testRunPaused', { id: runId });
  }

  resumeTestRun(runId) {
    const testRun = this.db.getTestRun(runId);
    if (!testRun || testRun.status !== 'paused') {
      throw new Error('Test run is not paused');
    }

    this.testRunner.resume();
    this.db.updateTestRun(runId, { status: 'running' });
    this.emit('testRunResumed', { id: runId });
  }

  cancelTestRun(runId) {
    if (this.currentRunId !== runId) {
      throw new Error('Test run is not currently running');
    }

    this._cancelledRuns.add(runId);
    this.testRunner.cancel();
    this.db.updateTestRun(runId, {
      status: 'cancelled',
      completedAt: new Date().toISOString()
    });
    this.currentRunId = null;
    this.emit('testRunCancelled', { id: runId });
  }

  // Finalize a run if every queued test has completed. Safe to call multiple
  // times; only transitions runs that are still 'running'.
  _maybeCompleteRun(runId) {
    const run = this.db.getTestRun(runId);
    if (!run || run.status !== 'running') return;
    if (run.totalTests > 0 && run.completedTests >= run.totalTests) {
      this.db.updateTestRun(runId, {
        status: 'completed',
        completedAt: new Date().toISOString()
      });
      this.emit('testRunCompleted', { id: runId });
      if (this.currentRunId === runId) {
        this.currentRunId = null;
      }
    }
  }

  onTestComplete(testResult) {
    // Use the testRunId from the result itself so completions are attributed
    // to the correct run even when a newer run has started.
    const runId = testResult.testRunId || this.currentRunId;
    if (!runId) return;

    const testRun = this.db.getTestRun(runId);
    if (!testRun) return;

    const completed = testRun.completedTests + 1;
    const successful = testRun.successfulTests + (testResult.success ? 1 : 0);
    const failed = testRun.failedTests + (testResult.success ? 0 : 1);

    this.db.updateTestRunProgress(runId, completed, successful, failed);

    this.emit('testRunProgress', {
      id: runId,
      completed,
      total: testRun.totalTests,
      successful,
      failed
    });

    // While items are still being queued, totalTests is only an estimate
    // (0 for scheduled runs) — finalizing here would end the run after the
    // first few completions. _maybeCompleteRun runs again once queueing ends.
    if (!this._queueingRuns.has(runId) && testRun.totalTests > 0 && completed >= testRun.totalTests) {
      this.db.updateTestRun(runId, {
        status: 'completed',
        completedAt: new Date().toISOString()
      });
      this.emit('testRunCompleted', { id: runId });
      if (this.currentRunId === runId) {
        this.currentRunId = null;
      }
    }
  }

  getTestRun(id) {
    return this.db.getTestRun(id);
  }

  getAllTestRuns() {
    return this.db.getAllTestRuns();
  }

  getActiveTestRun() {
    return this.db.getActiveTestRun();
  }

  getTestRunResults(id) {
    return this.db.getTestRunResults(id);
  }

  rerunTestRun(previousRunId) {
    const previousRun = this.db.getTestRun(previousRunId);
    if (!previousRun) {
      throw new Error('Test run not found');
    }

    const name = previousRun.name.endsWith('(rerun)')
      ? previousRun.name
      : `${previousRun.name} (rerun)`;
    const newRun = this.createTestRun(previousRun.config, name);

    this.emit('testRunRerun', { previousRunId, newRunId: newRun.id });
    return newRun;
  }
}

module.exports = TestRunManager;
