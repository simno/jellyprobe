const TestRunner = require('../../src/services/testRunner');
const EventEmitter = require('events');

describe('TestRunner', () => {
  let testRunner;
  let mockJellyfinClient;
  let mockDb;

  beforeEach(() => {
    mockJellyfinClient = {
      getItem: jest.fn(),
      startPlaybackSession: jest.fn(),
      reportPlaybackStarted: jest.fn(),
      reportPlaybackProgress: jest.fn(),
      stopPlayback: jest.fn(),
      getStreamUrl: jest.fn(),
      downloadHlsStream: jest.fn(),
      downloadVideoChunk: jest.fn(),
      isValidVideoData: jest.fn()
    };

    mockDb = { close: jest.fn(),
      getConfig: jest.fn().mockReturnValue({ testDuration: 1 }),
      getDevice: jest.fn().mockReturnValue({
        id: 1,
        name: 'Test Device',
        deviceId: 'test-dev-123',
        maxBitrate: 20000000,
        audioCodec: 'aac',
        videoCodec: 'h264'
      }),
      addTestResult: jest.fn()
    };

    testRunner = new TestRunner(mockJellyfinClient, mockDb);
  });

  afterEach(() => {
    testRunner.stop();
    if (mockDb.close) mockDb.close();
  });

  describe('initialization', () => {
    test('should extend EventEmitter', () => {
      expect(testRunner).toBeInstanceOf(EventEmitter);
    });

    test('should initialize with empty queue', () => {
      expect(testRunner.testQueue).toEqual([]);
      expect(testRunner.isRunning).toBe(false);
    });
  });

  describe('queueTest', () => {
    test('should add test to queue and process it', async () => {
      // Mock the test execution
      mockJellyfinClient.getItem.mockResolvedValue({
        Id: 'item-123',
        Name: 'Test Movie',
        Type: 'Movie',
        Path: '/media/test.mp4',
        Container: 'mp4',
        MediaSources: [
          {
            Id: 'source-123',
            RequiresOpening: false
          }
        ]
      });

      mockJellyfinClient.startPlaybackSession.mockResolvedValue({
        PlaySessionId: 'session-123',
        MediaSources: [{ Id: 'source-123', RequiresOpening: false }]
      });

      mockJellyfinClient.getStreamUrl.mockReturnValue('http://test.com/stream.mp4');
      mockJellyfinClient.downloadHlsStream.mockResolvedValue({
        success: true,
        bytesDownloaded: 5242880,
        segmentsDownloaded: 3
      });
      mockJellyfinClient.stopPlayback.mockResolvedValue({});

      // Queue and wait for completion
      await testRunner.queueTest('item-123', 1);
      
      // Should have processed (queue empty)
      expect(testRunner.testQueue.length).toBe(0);
    }, 15000);

    test('should emit queueUpdated event', async () => {
      const events = [];
      testRunner.on('queueUpdated', (data) => {
        events.push(data);
      });

      // Setup mocks
      mockJellyfinClient.getItem.mockResolvedValue({
        Id: 'item-123',
        Name: 'Test Movie',
        Type: 'Movie',
        Path: '/test.mp4',
        Container: 'mp4',
        MediaSources: [
          {
            Id: 'source-123',
            RequiresOpening: false
          }
        ]
      });

      mockJellyfinClient.startPlaybackSession.mockResolvedValue({
        PlaySessionId: 'session-123',
        MediaSources: [{ Id: 'source-123' }]
      });

      mockJellyfinClient.getStreamUrl.mockReturnValue('http://test.com/stream.mp4');
      mockJellyfinClient.downloadHlsStream.mockResolvedValue({
        success: true,
        bytesDownloaded: 5242880,
        segmentsDownloaded: 3
      });
      mockJellyfinClient.stopPlayback.mockResolvedValue({});

      await testRunner.queueTest('item-123', 1);

      expect(events.length).toBeGreaterThan(0);
      expect(events[0]).toHaveProperty('queueLength');
    }, 15000);
  });

  describe('getQueueStatus', () => {
    test('should return current status', () => {
      const status = testRunner.getQueueStatus();
      expect(status).toHaveProperty('queueLength');
      expect(status).toHaveProperty('isRunning');
    });

    test('should reflect queue length', () => {
      testRunner.testQueue = [
        { itemId: 'item-1', deviceId: 1 },
        { itemId: 'item-2', deviceId: 1 }
      ];
      
      const status = testRunner.getQueueStatus();
      expect(status.queueLength).toBe(2);
    });
  });

  describe('pause and resume', () => {
    test('should pause execution', () => {
      testRunner.pause();
      expect(testRunner.isPaused).toBe(true);
    });

    test('should resume execution', () => {
      testRunner.pause();
      testRunner.resume();
      expect(testRunner.isPaused).toBe(false);
    });

    test('should emit paused event', (done) => {
      testRunner.on('paused', () => {
        expect(testRunner.isPaused).toBe(true);
        done();
      });
      testRunner.pause();
    });

    test('should emit resumed event', (done) => {
      testRunner.pause();
      testRunner.on('resumed', () => {
        expect(testRunner.isPaused).toBe(false);
        done();
      });
      testRunner.resume();
    });
  });

  describe('cancel and clearQueue', () => {
    test('should cancel execution', () => {
      testRunner.cancel();
      expect(testRunner.isCancelled).toBe(true);
    });

    test('should emit cancelled event', (done) => {
      testRunner.on('cancelled', () => {
        expect(testRunner.isCancelled).toBe(true);
        done();
      });
      testRunner.cancel();
    });

    test('should clear queue', () => {
      testRunner.testQueue = [
        { itemId: 'item-1', deviceId: 1 },
        { itemId: 'item-2', deviceId: 1 }
      ];
      
      testRunner.clearQueue();
      expect(testRunner.testQueue.length).toBe(0);
    });
  });

  describe('configuration', () => {
    test('should update maxParallelTests', () => {
      testRunner.setMaxParallelTests(5);
      expect(testRunner.maxParallelTests).toBe(5);
    });
  });

  describe('events', () => {
    test('should emit testStarted event during test', async () => {
      const startedEvent = jest.fn();
      testRunner.on('testStarted', startedEvent);

      // Setup minimal mock for execution
      mockJellyfinClient.getItem.mockResolvedValue({
        Id: 'item-1', Name: 'Item', Type: 'Movie', Path: 'path',
        MediaSources: [{ Id: 's1', MediaStreams: [] }]
      });
      mockJellyfinClient.startPlaybackSession.mockResolvedValue({
        PlaySessionId: 'session1', MediaSources: [{ Id: 's1' }]
      });
      mockJellyfinClient.getStreamUrl.mockReturnValue('http://url');
      mockJellyfinClient.downloadHlsStream = jest.fn().mockResolvedValue({ success: true, bytesDownloaded: 100 });
      mockJellyfinClient.reportPlaybackStarted.mockResolvedValue({});
      mockJellyfinClient.reportPlaybackProgress.mockResolvedValue({});
      mockJellyfinClient.stopPlayback.mockResolvedValue({});

      await testRunner.runTest({
        itemId: 'item-1',
        deviceId: 1,
        deviceConfig: {
          deviceId: 'test-dev-123',
          maxBitrate: 20000000,
          audioCodec: 'aac',
          videoCodec: 'h264',
          maxWidth: 1920,
          maxHeight: 1080
        },
        testConfig: { duration: 0 }
      });
      
      expect(startedEvent).toHaveBeenCalled();
    }, 10000);
  });
});
