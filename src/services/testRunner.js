const EventEmitter = require('events');

// Spread/jitter range values (ms)
const MIN_SPREAD_MS = 500; // min 0.5s
const MAX_SPREAD_MS = 120000; // max 2 minutes

class TestRunner extends EventEmitter {
  constructor(jellyfinClient, db) {
    super();
    this.jellyfinClient = jellyfinClient;
    this.db = db;
    this.testQueue = [];
    this.isRunning = false;
    this.isPaused = false;
    this.isCancelled = false;
    this.currentTests = [];
    this.maxParallelTests = 1;

    // scheduled start timers: [{ timer, test }]
    this._scheduledStarts = [];

    // active AbortControllers for in-flight HLS downloads
    this._abortControllers = new Set();
  }

  async queueTest(itemId, deviceId, options = {}) {
    const device = this.db.getDevice(deviceId);
    if (!device) {
      throw new Error(`Device ${deviceId} not found`);
    }

    const config = this.db.getConfig() || {};
    const testObj = {
      itemId,
      deviceId,
      deviceConfig: {
        deviceId: device.deviceId,
        maxBitrate: device.maxBitrate,
        audioCodec: device.audioCodec,
        videoCodec: device.videoCodec,
        maxWidth: device.maxWidth || 1920,
        maxHeight: device.maxHeight || 1080
      },
      testConfig: {
        duration: options.duration !== undefined ? options.duration : (config.testDuration || 30)
      }
    };

    this.testQueue.push(testObj);
    this.emit('queueUpdated', {
      queueLength: this.testQueue.length,
      activeTests: this.currentTests.length
    });

    if (!this.isRunning) {
      this.processQueue();
    }
  }

  // Add test to queue without triggering processing
  addTestToQueue(testObject) {
    this.testQueue.push(testObject);
    this.emit('queueUpdated', {
      queueLength: this.testQueue.length,
      activeTests: this.currentTests.length
    });

    // Note: do not automatically start processing here — callers may intentionally batch-add tests
  }

  pause() {
    if (!this.isPaused) {
      this.isPaused = true;
      this._clearScheduledStarts(true);
      this.emit('paused');
    }
  }

  resume() {
    if (this.isPaused) {
      this.isPaused = false;
      this.emit('resumed');
      if (!this.isRunning && this.testQueue.length > 0) {
        this.processQueue();
      }
    }
  }

  stop() {
    this.testQueue = [];
    this.isCancelled = true;
    this.isRunning = false;
    this._clearScheduledStarts(false);
    for (const ac of this._abortControllers) {
      ac.abort();
    }
    this._abortControllers.clear();
    const pending = this.currentTests.slice();
    return pending.length > 0
      ? Promise.allSettled(pending)
      : Promise.resolve();
  }

  cancel() {
    this.testQueue = [];
    this.isPaused = false;
    this.isCancelled = true;
    this._clearScheduledStarts(false);
    for (const ac of this._abortControllers) {
      ac.abort();
    }
    this._abortControllers.clear();
    this.emit('cancelled');
    this.emit('queueUpdated', {
      queueLength: 0,
      activeTests: this.currentTests.length
    });
    const pending = this.currentTests.slice();
    return pending.length > 0
      ? Promise.allSettled(pending)
      : Promise.resolve();
  }

  setMaxParallelTests(max) {
    this.maxParallelTests = Math.max(1, Math.min(10, max));
    console.log(`[TestRunner] maxParallelTests set to ${this.maxParallelTests} (requested: ${max})`);
  }

  // Helper: clear scheduled start timers. If returnToQueue=true, push tests back to front of queue
  _clearScheduledStarts(returnToQueue = true) {
    if (!this._scheduledStarts || this._scheduledStarts.length === 0) return;
    for (const entry of this._scheduledStarts) {
      try { clearTimeout(entry.timer); } catch (_e) { /* ignore */ }
      if (returnToQueue && entry.test) {
        this.testQueue.unshift(entry.test);
      }
    }
    this._scheduledStarts = [];
    this.emit('queueUpdated', { queueLength: this.testQueue.length, activeTests: this.currentTests.length });
  }

  _startTestImmediate(test) {
    if (this.isCancelled) return;
    if (this.isPaused) {
      this.testQueue.unshift(test);
      this.emit('queueUpdated', { queueLength: this.testQueue.length, activeTests: this.currentTests.length });
      return;
    }

    // Enforce parallel limit — a jitter timer may fire after other tests filled slots
    if (this.currentTests.length >= this.maxParallelTests) {
      this.testQueue.unshift(test);
      this._scheduledStarts = this._scheduledStarts.filter(s => s.test !== test);
      this.emit('queueUpdated', { queueLength: this.testQueue.length, activeTests: this.currentTests.length });
      return;
    }

    this._scheduledStarts = this._scheduledStarts.filter(s => s.test !== test);

    const testPromise = this.runTest(test);
    this.currentTests.push(testPromise);
    this.emit('scheduledStart');

    testPromise.finally(() => {
      const index = this.currentTests.indexOf(testPromise);
      if (index > -1) {
        this.currentTests.splice(index, 1);
      }

      this.emit('queueUpdated', {
        queueLength: this.testQueue.length,
        activeTests: this.currentTests.length
      });
    });

    this.emit('queueUpdated', {
      queueLength: this.testQueue.length,
      activeTests: this.currentTests.length
    });
  }

  async processQueue() {
    if (this.isRunning || this.testQueue.length === 0) {
      return;
    }

    this.isRunning = true;
    this.isCancelled = false;

    while ((this.testQueue.length > 0 || this.currentTests.length > 0 || this._scheduledStarts.length > 0) && !this.isCancelled) {
      if (this.isCancelled) {
        break;
      }

      if (this.isPaused) {
        await new Promise(resolve => {
          this.once('resumed', resolve);
        });
      }

      if (this.isCancelled) {
        break;
      }

      const availableSlots = Math.max(0, this.maxParallelTests - this.currentTests.length - this._scheduledStarts.length);
      if (availableSlots <= 0) {
        if (this.currentTests.length > 0) {
          await Promise.race(this.currentTests);
          // Small delay to allow cleanup and event processing
          await new Promise(resolve => setTimeout(resolve, 50));
          continue;
        }
      }

      const slotsToFill = Math.min(this.testQueue.length, availableSlots);

      if (slotsToFill > 0) {
        // Compute spread/jitter duration (ms). Feature is opt-in: config.spreadStartOverMs > 0 enables spreading.
        const config = this.db.getConfig() || {};
        let spreadMs;
        if (typeof config.spreadStartOverMs === 'number' && config.spreadStartOverMs > 0) {
          spreadMs = Math.min(MAX_SPREAD_MS, Math.max(MIN_SPREAD_MS, Math.floor(config.spreadStartOverMs)));
        } else {
          // Fallback: use configured test duration (seconds) if available
          const testDurationSec = (config.testDuration && Number.isFinite(Number(config.testDuration))) ? Number(config.testDuration) : null;
          if (testDurationSec && testDurationSec > 0) {
            spreadMs = Math.min(MAX_SPREAD_MS, Math.max(MIN_SPREAD_MS, Math.floor(testDurationSec * 1000)));
          } else {
            // No config -> default spread disabled (0) to keep previous behaviour
            spreadMs = 0;
          }
        }

        if (spreadMs <= 0 || slotsToFill === 1) {
          for (let i = 0; i < slotsToFill; i++) {
            const test = this.testQueue.shift();
            this._startTestImmediate(test);
          }
        } else {
          for (let i = 0; i < slotsToFill; i++) {
            const test = this.testQueue.shift();
            const delay = Math.round((i / slotsToFill) * spreadMs);
            const timer = setTimeout(() => {
              if (!this.isCancelled) {
                this._startTestImmediate(test);
              }
            }, delay);

            this._scheduledStarts.push({ timer, test });
            this.emit('queueUpdated', { queueLength: this.testQueue.length, activeTests: this.currentTests.length });
          }
        }
      }

      // Wait for at least one test to complete OR a scheduled start to fire
      if (this.currentTests.length > 0) {
        await Promise.race(this.currentTests);
        // Small delay to allow cleanup and event processing
        await new Promise(resolve => setTimeout(resolve, 50));
      } else if (this._scheduledStarts.length > 0) {
        // Wait until a scheduled start occurs (emitted in _startTestImmediate)
        await new Promise(resolve => this.once('scheduledStart', resolve));
      } else {
        // Nothing running or scheduled; small sleep to avoid busy loop
        await new Promise(resolve => setTimeout(resolve, 50));
      }
    }

    this.isRunning = false;
    this.isCancelled = false;
  }

  async runTest(testObj) {
    const abortController = new AbortController();
    this._abortControllers.add(abortController);

    const startTime = Date.now();
    let playSessionId = null;
    let deviceIdForPlayback = null;
    let testResult = {
      testRunId: testObj.testRunId,
      itemId: testObj.itemId,
      itemName: testObj.itemName || '',
      path: testObj.path || '',
      deviceId: testObj.deviceId,
      format: testObj.container || '',
      duration: 0,
      errors: [],
      success: false
    };

    this.emit('testStarted', testResult);

    try {
      // Use item info already on the test object when available (avoids a redundant API call)
      if (!testResult.itemName || !testResult.format) {
        const item = await this.jellyfinClient.getItem(testObj.itemId);

        if (item) {
          if (!testResult.itemName) {
            if (item.Type === 'Episode' && item.SeriesName) {
              const season = item.ParentIndexNumber ? `S${item.ParentIndexNumber}` : '';
              const episode = item.IndexNumber ? `E${item.IndexNumber}` : '';
              const episodeNum = season || episode ? ` ${season}${episode}` : '';
              testResult.itemName = `${item.SeriesName}${episodeNum} - ${item.Name}`;
            } else {
              testResult.itemName = item.Name;
            }
          }

          if (!testResult.path) testResult.path = item.Path || '';
          if (!testResult.format) testResult.format = item.Container || '';
        } else {
          testResult.format = testObj.path ? testObj.path.split('.').pop() : '';
        }
      }

      this.emit('testProgress', { ...testResult, stage: 'Starting playback session' });

      const playbackInfo = await this.jellyfinClient.startPlaybackSession(
        testObj.itemId,
        testObj.deviceConfig.deviceId || `jellyprobe-${testObj.deviceId}`,
        {
          maxBitrate: testObj.deviceConfig.maxBitrate,
          audioCodec: testObj.deviceConfig.audioCodec,
          videoCodec: testObj.deviceConfig.videoCodec,
          maxWidth: testObj.deviceConfig.maxWidth || 1920,
          maxHeight: testObj.deviceConfig.maxHeight || 1080
        }
      );

      if (!playbackInfo.MediaSources || playbackInfo.MediaSources.length === 0) {
        throw new Error('No media sources available');
      }

      const mediaSource = playbackInfo.MediaSources[0];
      playSessionId = playbackInfo.PlaySessionId || mediaSource.Id;
      deviceIdForPlayback = testObj.deviceConfig.deviceId || `jellyprobe-${testObj.deviceId}`;
      const ticksPerSecond = 10000000;

      const testDuration = testObj.testConfig.duration || 30;

      const streamUrl = this.jellyfinClient.getStreamUrl(
        testObj.itemId,
        mediaSource.Id,
        testObj.deviceConfig.deviceId || `jellyprobe-${testObj.deviceId}`,
        {
          playSessionId,
          maxBitrate: testObj.deviceConfig.maxBitrate,
          audioCodec: testObj.deviceConfig.audioCodec,
          videoCodec: testObj.deviceConfig.videoCodec,
          maxWidth: testObj.deviceConfig.maxWidth || 1920,
          maxHeight: testObj.deviceConfig.maxHeight || 1080,
          container: testResult.format || 'mp4'
        }
      );

      // Emit stream info so the frontend can display live preview
      this.emit('testStreamReady', {
        testRunId: testObj.testRunId,
        itemId: testObj.itemId,
        itemName: testResult.itemName,
        deviceId: testObj.deviceId,
        mediaSourceId: mediaSource.Id,
        playSessionId,
        deviceConfig: testObj.deviceConfig,
        format: testResult.format || 'mp4'
      });

      // Report playback started so session appears on Jellyfin dashboard (fire-and-forget)
      this.jellyfinClient.reportPlaybackStarted(
        testObj.itemId, playSessionId, mediaSource.Id, deviceIdForPlayback
      );

      console.log(`[TestRunner] Running test: itemId=${testObj.itemId}, testDuration=${testDuration}, testConfig=${JSON.stringify(testObj.testConfig)}`);

      this.emit('testProgress', {
        ...testResult,
        stage: `Testing HLS playback for ${testDuration}s`
      });

      // Periodic progress reporting so Jellyfin keeps the session visible
      let progressElapsed = 0;
      const progressInterval = setInterval(() => {
        progressElapsed += 5;
        this.jellyfinClient.reportPlaybackProgress(
          testObj.itemId, playSessionId,
          progressElapsed * ticksPerSecond, deviceIdForPlayback
        );
      }, 5000);

      // Download HLS stream segments to trigger and validate transcoding
      let hlsResult;
      try {
        hlsResult = await this.jellyfinClient.downloadHlsStream(
          streamUrl,
          testDuration,
          (progress) => {
            this.emit('bandwidthUpdate', {
              testRunId: testObj.testRunId,
              deviceId: testObj.deviceId,
              itemId: testObj.itemId,
              bytesThisSecond: progress.bytesThisSecond,
              totalBytes: progress.totalBytes,
              elapsedSeconds: progress.elapsedSeconds
            });
          },
          { signal: abortController.signal }
        );
      } finally {
        clearInterval(progressInterval);
      }

      if (!hlsResult.success) {
        throw new Error(`HLS stream failed: ${hlsResult.error}`);
      }

      testResult.bytesDownloaded = hlsResult.bytesDownloaded;
      this.emit('testProgress', {
        ...testResult,
        stage: `Downloaded ${(hlsResult.bytesDownloaded / 1024 / 1024).toFixed(2)} MB (${hlsResult.segmentsDownloaded} segments)`
      });

      // Notify frontend to tear down preview before stopping the transcode
      this.emit('testStreamEnding', { testRunId: testObj.testRunId, itemId: testObj.itemId, deviceId: testObj.deviceId });

      const finalPositionTicks = testDuration * ticksPerSecond;
      await this.jellyfinClient.stopPlayback(
        testObj.itemId,
        playSessionId,
        finalPositionTicks,
        deviceIdForPlayback
      );

      testResult.success = true;
      testResult.duration = Math.floor((Date.now() - startTime) / 1000);

      this.emit('testProgress', { ...testResult, stage: 'Test completed successfully' });

    } catch (error) {
      testResult.errors.push(error.message);
      testResult.success = false;
      testResult.duration = Math.floor((Date.now() - startTime) / 1000);

      // Notify frontend to tear down preview before stopping the transcode
      if (playSessionId) {
        this.emit('testStreamEnding', { testRunId: testObj.testRunId, itemId: testObj.itemId, deviceId: testObj.deviceId });
      }

      if (playSessionId) {
        try {
          await this.jellyfinClient.stopPlayback(
            testObj.itemId,
            playSessionId,
            0,
            deviceIdForPlayback
          );
        } catch (_e) {
          // Best-effort cleanup
        }
      }

      this.emit('testProgress', {
        ...testResult,
        stage: `Test failed: ${error.message}`
      });
    } finally {
      this._abortControllers.delete(abortController);
    }

    try {
      this.db.addTestResult(testResult);
    } catch (dbErr) {
      console.error('[TestRunner] Failed to save test result:', dbErr.message);
    }
    this.emit('testCompleted', testResult);

    return testResult;
  }

  getQueueStatus() {
    return {
      queueLength: this.testQueue.length,
      isRunning: this.isRunning
    };
  }

  clearQueue() {
    this.testQueue = [];
    this.emit('queueUpdated', { queueLength: 0 });
  }

}

module.exports = TestRunner;
