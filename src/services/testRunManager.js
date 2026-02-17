const EventEmitter = require('events');

class TestRunManager extends EventEmitter {
  constructor(db, testRunner, jellyfinClient) {
    super();
    this.db = db;
    this.testRunner = testRunner;
    this.jellyfinClient = jellyfinClient;
    this.currentRunId = null;
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

  async startTestRun(runId) {
    const testRun = this.db.getTestRun(runId);
    if (!testRun) {
      throw new Error('Test run not found');
    }

    if (testRun.status !== 'pending') {
      throw new Error('Test run is not in pending state');
    }

    this.currentRunId = runId;

    // Clear any leftover items from a previous run
    this.testRunner.clearQueue();

    this.db.updateTestRun(runId, {
      status: 'running',
      startedAt: new Date().toISOString()
    });

    const config = this.db.getConfig();
    if (config && config.maxParallelTests) {
      this.testRunner.setMaxParallelTests(config.maxParallelTests);
      console.log(`Set maxParallelTests to ${config.maxParallelTests}`);
    }

    const scope = testRun.config.mediaScope;
    const { devices, testConfig, mediaItems } = testRun.config;

    console.log(`[TestRunManager] Starting test run ${runId}:`);
    console.log(`  - testRun.config keys: ${Object.keys(testRun.config).join(', ')}`);
    console.log(`  - scope: ${JSON.stringify(scope)}`);
    console.log(`  - testConfig: ${JSON.stringify(testConfig)}`);
    console.log(`  - mediaItems: ${Array.isArray(mediaItems) ? mediaItems.length + ' items' : 'undefined/null'}`);

    try {
      this.emit('testRunStarted', { id: runId });

      // Fetch and queue media items in batches — processing starts as items arrive
      this._queueMediaItemsInBatches(runId, devices, scope, testConfig || {})
        .catch(err => {
          console.error(`Failed to queue media items for test run ${runId}:`, err.message);
          this.emit('testRunError', { id: runId, error: err.message });
        });

    } catch (err) {
      console.error(`Failed to start test run ${runId}:`, err.message);
      this.db.updateTestRun(runId, { status: 'failed', completedAt: new Date().toISOString() });
      this.emit('testRunError', { id: runId, error: err.message });
      throw err;
    }

    return { success: true };
  }

  async _queueMediaItemsInBatches(runId, devices, scope, testConfig) {
    const BATCH_SIZE = 100;
    let totalQueued = 0;

    try {
      console.log(`[TestRunManager] Queueing media: scope=${JSON.stringify(scope)}, devices=${devices.length}`);

      if (scope && scope.type === 'all') {
        for (const libId of scope.libraryIds) {
          let start = 0, hasMore = true;
          while (hasMore) {
            const r = await this.jellyfinClient.getLibraryItems(libId, BATCH_SIZE, start);
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
          const r = await this.jellyfinClient.getRecentLibraryItems(libId, days, 10000);
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
          try {
            const item = await this.jellyfinClient.getItem(itemId);
            if (item) items.push(item);
          } catch (e) {
            console.warn(`[TestRunManager] Failed to fetch item ${itemId}: ${e.message}`);
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
          console.log(`[TestRunManager] Using mediaItems fallback: ${testRun.config.mediaItems.length} items`);
          totalQueued += this._queueTestBatch(runId, devices, testRun.config.mediaItems, testConfig);
          this.testRunner.processQueue();
        } else {
          console.warn(`[TestRunManager] No items resolved for run ${runId} (scope=${JSON.stringify(scope)})`);
        }
      }

      console.log(`[TestRunManager] Total queued tests: ${totalQueued}`);

      // Correct totalTests if the actual count differs from the estimate
      const testRun = this.db.getTestRun(runId);
      if (totalQueued !== testRun.totalTests && totalQueued > 0) {
        this.db.updateTestRun(runId, { totalTests: totalQueued });
      }
    } catch (err) {
      console.error(`[TestRunManager] Error queuing media for run ${runId}: ${err.message}`);
      throw err;
    }
  }

  _queueTestBatch(runId, devices, items, testConfig) {
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

    this.testRunner.cancel();
    this.db.updateTestRun(runId, {
      status: 'cancelled',
      completedAt: new Date().toISOString()
    });
    this.currentRunId = null;
    this.emit('testRunCancelled', { id: runId });
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

    if (completed >= testRun.totalTests) {
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
}

module.exports = TestRunManager;
