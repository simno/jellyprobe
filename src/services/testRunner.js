const EventEmitter = require('events');

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
  }

  async queueTest(itemId, deviceId, options = {}) {
    this.testQueue.push({ itemId, deviceId, options });
    this.emit('queueUpdated', { 
      queueLength: this.testQueue.length,
      activeTests: this.currentTests.length
    });
    
    if (!this.isRunning) {
      this.processQueue();
    }
  }

  // New method for v2.0 - add full test object to queue
  addTest(testObject) {
    this.testQueue.push(testObject);
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
  }

  pause() {
    if (!this.isPaused) {
      this.isPaused = true;
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
  }

  cancel() {
    this.testQueue = [];
    this.isPaused = false;
    this.isCancelled = true; // Add cancellation flag
    this.emit('cancelled');
    this.emit('queueUpdated', { 
      queueLength: 0,
      activeTests: this.currentTests.length
    });
  }

  setMaxParallelTests(max) {
    this.maxParallelTests = Math.max(1, Math.min(10, max));
    console.log(`[TestRunner] maxParallelTests set to ${this.maxParallelTests} (requested: ${max})`);
  }

  async processQueue() {
    if (this.isRunning || this.testQueue.length === 0) {
      return;
    }

    this.isRunning = true;
    this.isCancelled = false; // Reset cancellation flag

    while ((this.testQueue.length > 0 || this.currentTests.length > 0) && !this.isCancelled) {
      // Check if cancelled
      if (this.isCancelled) {
        break;
      }

      // Check if paused
      if (this.isPaused) {
        await new Promise(resolve => {
          this.once('resumed', resolve);
        });
      }

      // Check if cancelled again after resume
      if (this.isCancelled) {
        break;
      }

      // Start new tests up to max parallel
      while (this.testQueue.length > 0 && this.currentTests.length < this.maxParallelTests && !this.isCancelled) {
        const test = this.testQueue.shift();
        
        // Handle both old format (itemId, deviceId, options) and new format (full test object)
        const testPromise = test.itemId && test.deviceId && !test.testRunId
          ? this.runTest(test.itemId, test.deviceId, test.options)
          : this.runTestV2(test);
        
        // Add to currentTests FIRST
        this.currentTests.push(testPromise);
        
        // Set up cleanup when test completes
        testPromise.finally(() => {
          // Remove from currentTests array
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

      // Wait for at least one test to complete before continuing
      // Only wait if we have tests running
      if (this.currentTests.length > 0 && !this.isCancelled) {
        await Promise.race(this.currentTests);
        // Small delay to allow cleanup and event processing
        await new Promise(resolve => setTimeout(resolve, 50));
      }
    }

    this.isRunning = false;
    this.isCancelled = false; // Reset flag
  }

  async runTest(itemId, deviceId, options = {}) {
    const startTime = Date.now();
    let testResult = {
      itemId,
      itemName: '',
      path: '',
      deviceId,
      format: '',
      duration: 0,
      errors: [],
      success: false
    };

    this.emit('testStarted', testResult);

    try {
      const item = await this.jellyfinClient.getItem(itemId);
      testResult.itemName = item.Name;
      testResult.path = item.Path || '';
      testResult.format = item.Container || '';

      this.emit('testProgress', { ...testResult, stage: 'Fetching item info' });

      const device = this.db.getDevice(deviceId);
      if (!device) {
        throw new Error(`Device ${deviceId} not found`);
      }

      this.emit('testProgress', { ...testResult, stage: 'Starting playback session' });

      const playbackInfo = await this.jellyfinClient.startPlaybackSession(itemId, device.deviceId, {
        maxBitrate: device.maxBitrate,
        audioCodec: device.audioCodec,
        videoCodec: device.videoCodec,
        maxWidth: device.maxWidth || 1920,
        maxHeight: device.maxHeight || 1080
      });

      if (!playbackInfo.MediaSources || playbackInfo.MediaSources.length === 0) {
        throw new Error('No media sources available');
      }

      const mediaSource = playbackInfo.MediaSources[0];
      const playSessionId = playbackInfo.PlaySessionId || mediaSource.Id;

      if (mediaSource.RequiresOpening) {
        this.emit('testProgress', { ...testResult, stage: 'Opening media stream' });
      }

      const config = this.db.getConfig();
      const testDuration = (options.duration !== undefined) ? options.duration : (config.testDuration || 30);
      const ticksPerSecond = 10000000;

      this.emit('testProgress', { 
        ...testResult, 
        stage: `Testing playback for ${testDuration}s` 
      });

      for (let elapsed = 0; elapsed < testDuration; elapsed += 5) {
        const positionTicks = elapsed * ticksPerSecond;
        
        await this.jellyfinClient.reportPlaybackProgress(
          itemId,
          playSessionId,
          positionTicks,
          device.deviceId
        );

        this.emit('testProgress', {
          ...testResult,
          stage: `Testing: ${elapsed}s / ${testDuration}s`
        });

        await new Promise(resolve => setTimeout(resolve, 5000));
      }

      const finalPositionTicks = testDuration * ticksPerSecond;
      await this.jellyfinClient.stopPlayback(
        itemId,
        playSessionId,
        finalPositionTicks,
        device.deviceId
      );

      const sessions = await this.jellyfinClient.getActiveSessions();
      const activeSession = sessions.find(s => 
        s.DeviceId === device.deviceId && 
        s.NowPlayingItem?.Id === itemId
      );

      if (activeSession && activeSession.PlayState?.PlayMethod === 'Transcode') {
        this.emit('testProgress', { ...testResult, stage: 'Transcoding detected' });
      }

      testResult.success = true;
      testResult.duration = Math.floor((Date.now() - startTime) / 1000);

      this.emit('testProgress', { ...testResult, stage: 'Test completed successfully' });

    } catch (error) {
      testResult.errors.push(error.message);
      testResult.success = false;
      testResult.duration = Math.floor((Date.now() - startTime) / 1000);
      
      this.emit('testProgress', { 
        ...testResult, 
        stage: `Test failed: ${error.message}` 
      });
    }

    this.db.addTestResult(testResult);
    this.emit('testCompleted', testResult);
    this.currentTest = null;

    return testResult;
  }

  getQueueStatus() {
    return {
      queueLength: this.testQueue.length,
      isRunning: this.isRunning,
      currentTest: this.currentTest
    };
  }

  clearQueue() {
    this.testQueue = [];
    this.emit('queueUpdated', { queueLength: 0 });
  }

  // New method for v2.0 - run test with full test object including seek testing
  async runTestV2(testObj) {
    const startTime = Date.now();
    let testResult = {
      testRunId: testObj.testRunId,
      itemId: testObj.itemId,
      itemName: testObj.itemName || '',
      path: testObj.path || '',
      deviceId: testObj.deviceId,
      format: '',
      duration: 0,
      seekTested: false,
      seekSuccess: false,
      errors: [],
      success: false
    };

    this.emit('testStarted', testResult);

    try {
      // Always fetch item info for format/path details
      const item = await this.jellyfinClient.getItem(testObj.itemId);
      
      if (item) {
        // Use pre-formatted itemName from testObj if available, otherwise format here
        if (!testObj.itemName) {
          // Format TV episodes as "Series Name S01E02 - Episode Name"
          if (item.Type === 'Episode' && item.SeriesName) {
            const season = item.ParentIndexNumber ? `S${item.ParentIndexNumber}` : '';
            const episode = item.IndexNumber ? `E${item.IndexNumber}` : '';
            const episodeNum = season || episode ? ` ${season}${episode}` : '';
            testResult.itemName = `${item.SeriesName}${episodeNum} - ${item.Name}`;
          } else {
            testResult.itemName = item.Name;
          }
        }
        // else: keep the pre-formatted testObj.itemName from testResult initialization
        
        testResult.path = item.Path || '';
        testResult.format = item.Container || '';
      } else {
        testResult.format = testObj.path ? testObj.path.split('.').pop() : '';
      }

      this.emit('testProgress', { ...testResult, stage: 'Starting playback session' });

      // Use device config from test object
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
      const playSessionId = playbackInfo.PlaySessionId || mediaSource.Id;
      const ticksPerSecond = 10000000;

      const testDuration = testObj.testConfig.duration || 30;

      // Get streaming URL for actual video download
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

      this.emit('testProgress', { 
        ...testResult, 
        stage: `Testing HLS playback for ${testDuration}s` 
      });

      // Download HLS stream segments to trigger and validate transcoding
      const hlsResult = await this.jellyfinClient.downloadHlsStream(
        streamUrl,
        testDuration
      );

      if (!hlsResult.success) {
        throw new Error(`HLS stream failed: ${hlsResult.error}`);
      }

      testResult.bytesDownloaded = hlsResult.bytesDownloaded;
      testResult.seekTested = false;
      testResult.seekSuccess = false;
      this.emit('testProgress', { 
        ...testResult, 
        stage: `Downloaded ${(hlsResult.bytesDownloaded / 1024 / 1024).toFixed(2)} MB (${hlsResult.segmentsDownloaded} segments)` 
      });

      // Stop playback
      const finalPositionTicks = testDuration * ticksPerSecond;
      await this.jellyfinClient.stopPlayback(
        testObj.itemId,
        playSessionId,
        finalPositionTicks,
        testObj.deviceConfig.deviceId || `jellyprobe-${testObj.deviceId}`
      );

      testResult.success = true;
      testResult.duration = Math.floor((Date.now() - startTime) / 1000);

      this.emit('testProgress', { ...testResult, stage: 'Test completed successfully' });

    } catch (error) {
      testResult.errors.push(error.message);
      testResult.success = false;
      testResult.duration = Math.floor((Date.now() - startTime) / 1000);
      
      this.emit('testProgress', { 
        ...testResult, 
        stage: `Test failed: ${error.message}` 
      });
    }

    this.db.addTestResult(testResult);
    this.emit('testCompleted', testResult);

    return testResult;
  }
}

module.exports = TestRunner;
