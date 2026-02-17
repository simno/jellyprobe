const TestRunner = require('../../src/services/testRunner');

describe('TestRunner staggered starts (jitter)', () => {
  let testRunner;
  let mockJellyfinClient;
  let mockDb;

  beforeEach(() => {
    jest.useFakeTimers();

    mockJellyfinClient = {
      getItem: jest.fn(),
      startPlaybackSession: jest.fn(),
      reportPlaybackStarted: jest.fn(),
      reportPlaybackProgress: jest.fn(),
      stopPlayback: jest.fn(),
      getStreamUrl: jest.fn(),
      downloadVideoChunk: jest.fn(),
      isValidVideoData: jest.fn()
    };

    // Provide a config enabling spreadStartOverMs
    mockDb = {
      close: jest.fn(),
      getConfig: jest.fn().mockReturnValue({ spreadStartOverMs: 10000 }),
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
    // cleanup timers
    try { testRunner.stop(); } catch (e) {}
    if (mockDb.close) mockDb.close();
    jest.useRealTimers();
  });

  test('should stagger starts across configured spread interval', async () => {
    // Spy on internal _startTestImmediate and replace with a lightweight stub that emits the scheduledStart event
    const calls = [];
    jest.spyOn(testRunner, '_startTestImmediate').mockImplementation((test) => {
      calls.push(test);
      // Emit the event so processQueue can continue waiting logic
      testRunner.emit('scheduledStart');
    });

    // Allow up to 10 parallel
    testRunner.setMaxParallelTests(10);

    // Batch-add 10 tests without triggering processing
    for (let i = 0; i < 10; i++) {
      testRunner.addTestToQueue({ itemId: `item-${i}`, deviceId: 1, options: { duration: 0 } });
    }

    // Now explicitly start processing so the batch is scheduled together
    testRunner.processQueue();

    // At this point scheduled timers should be set for 10 starts
    expect(testRunner._scheduledStarts.length).toBe(10);
    expect(calls.length).toBe(0);

    // First start has delay 0 -> should fire immediately when timers advanced by 0
    jest.advanceTimersByTime(0);
    expect(calls.length).toBe(1);

    // After 1s (1000ms) the second should fire
    jest.advanceTimersByTime(1000);
    expect(calls.length).toBe(2);

    // Advance to cover remaining starts (up to 10s total)
    jest.advanceTimersByTime(9000);
    expect(calls.length).toBe(10);

    // Ensure all scheduled timers cleared from internal list when starts fired
    // (our stub doesn't remove scheduled entries, but the implementation's _startTestImmediate removes them)
    // Allow processQueue loop to run through - emit scheduledStart already happened for each call
  });
});
