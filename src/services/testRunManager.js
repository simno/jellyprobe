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
    const timeStr = date.toTimeString().split(' ')[0].replace(/:/g, '');
    return `Test Run ${dateStr} ${timeStr}`;
  }

  createTestRun(config) {
    const name = this.generateTestRunName();
    
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
    this.db.updateTestRun(runId, {
      status: 'running',
      startedAt: new Date().toISOString()
    });

    // Set parallel tests from config (if available)
    const config = this.db.getConfig();
    if (config && config.maxParallelTests) {
      this.testRunner.setMaxParallelTests(config.maxParallelTests);
      console.log(`Set maxParallelTests to ${config.maxParallelTests}`);
    }

    const scope = testRun.config.mediaScope;
    const { devices, testConfig } = testRun.config;

    try {
      // Start processing queue immediately (for responsive UX)
      this.testRunner.processQueue();
      this.emit('testRunStarted', { id: runId });

      // Fetch and queue media items in batches (non-blocking)
      this._queueMediaItemsInBatches(runId, devices, scope, testConfig).catch(err => {
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
      if (scope) {
        if (scope.type === 'all') {
          // Fetch all libraries' items in batches
          for (const libId of scope.libraryIds) {
            let start = 0, hasMore = true;
            while (hasMore) {
              const r = await this.jellyfinClient.getLibraryItems(libId, BATCH_SIZE, start);
              if (r.items && r.items.length > 0) {
                totalQueued += this._queueTestBatch(runId, devices, r.items, testConfig);
                start += r.items.length;
                hasMore = r.totalCount > start;
              } else {
                hasMore = false;
              }
            }
          }
        } else if (scope.type === 'recent') {
          const days = scope.days || 7;
          for (const libId of scope.libraryIds) {
            const r = await this.jellyfinClient.getRecentLibraryItems(libId, days, 10000);
            if (r.items && r.items.length > 0) {
              totalQueued += this._queueTestBatch(runId, devices, r.items, testConfig);
            }
          }
        } else if (scope.type === 'custom' && scope.itemIds) {
          // Fetch specific items by ID in batches
          const items = [];
          for (const itemId of scope.itemIds) {
            try {
              const item = await this.jellyfinClient.getItem(itemId);
              if (item) items.push(item);
            } catch (e) {
              console.warn(`Failed to fetch item ${itemId}: ${e.message}`);
            }
          }
          if (items.length > 0) {
            totalQueued += this._queueTestBatch(runId, devices, items, testConfig);
          }
        }
      }

      // Fallback for legacy mediaItems (if passed directly)
      if (totalQueued === 0) {
        const testRun = this.db.getTestRun(runId);
        if (testRun && testRun.config.mediaItems) {
          totalQueued += this._queueTestBatch(runId, devices, testRun.config.mediaItems, testConfig);
        }
      }

      // Update total tests count if different
      const testRun = this.db.getTestRun(runId);
      const estimatedTotal = testRun.totalTests;
      if (totalQueued !== estimatedTotal && estimatedTotal > 0) {
        console.log(`Updated: queued ${totalQueued} tests (estimated ${estimatedTotal})`);
        this.db.updateTestRun(runId, { totalTests: totalQueued });
      }
    } catch (err) {
      console.error(`Error queuing media items: ${err.message}`);
      throw err;
    }
  }

  _queueTestBatch(runId, devices, items, testConfig) {
    const tests = [];

    for (const device of devices) {
      for (const item of items) {
        let itemName = item.Name;
        if (item.Type === 'Episode' && item.SeriesName) {
          const season = item.ParentIndexNumber ? `S${item.ParentIndexNumber}` : '';
          const episode = item.IndexNumber ? `E${item.IndexNumber}` : '';
          const episodeNum = season || episode ? ` ${season}${episode}` : '';
          itemName = `${item.SeriesName}${episodeNum} - ${item.Name}`;
        }

        tests.push({
          testRunId: runId,
          itemId: item.Id,
          itemName: itemName,
          path: item.Path,
          deviceId: device.id,
          deviceName: device.name,
          deviceConfig: {
            maxBitrate: device.maxBitrate,
            audioCodec: device.audioCodec,
            videoCodec: device.videoCodec,
            maxWidth: device.maxWidth,
            maxHeight: device.maxHeight
          },
          testConfig: {
            duration: testConfig.duration,
            seekTest: testConfig.seekTest
          }
        });
      }
    }

    // Shuffle this batch
    for (let i = tests.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [tests[i], tests[j]] = [tests[j], tests[i]];
    }

    // Queue all tests in this batch
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
    if (!this.currentRunId) return;

    const testRun = this.db.getTestRun(this.currentRunId);
    if (!testRun) return;

    const completed = testRun.completedTests + 1;
    const successful = testRun.successfulTests + (testResult.success ? 1 : 0);
    const failed = testRun.failedTests + (testResult.success ? 0 : 1);

    this.db.updateTestRunProgress(this.currentRunId, completed, successful, failed);

    // Always emit progress update (including final 100%)
    this.emit('testRunProgress', {
      id: this.currentRunId,
      completed,
      total: testRun.totalTests,
      successful,
      failed
    });

    // Check if all tests are complete
    if (completed >= testRun.totalTests) {
      this.db.updateTestRun(this.currentRunId, {
        status: 'completed',
        completedAt: new Date().toISOString()
      });
      this.emit('testRunCompleted', { id: this.currentRunId });
      this.currentRunId = null;
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
