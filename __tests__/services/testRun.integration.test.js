const TestRunner = require('../../src/services/testRunner');
const TestRunManager = require('../../src/services/testRunManager');

jest.setTimeout(10000);

describe('Integration: TestRun end-to-end', () => {
  let mockDb;
  let mockJellyfinClient;
  let testRunner;
  let testRunManager;

  beforeEach(() => {
    // Simple in-memory mock DB used by TestRunner/TestRunManager
    const runs = {};
    const results = {};
    let nextRunId = 1;

    mockDb = {
      createTestRun: jest.fn((name, config) => {
        const id = nextRunId++;
        runs[id] = {
          id,
          name,
          status: 'pending',
          config,
          totalTests: config.totalTests || 0,
          completedTests: 0,
          successfulTests: 0,
          failedTests: 0
        };
        return id;
      }),
      getTestRun: jest.fn((id) => {
        return runs[id];
      }),
      updateTestRun: jest.fn((id, updates) => {
        runs[id] = { ...runs[id], ...updates };
        return runs[id];
      }),
      updateTestRunProgress: jest.fn((id, completed, successful, failed) => {
        const r = runs[id];
        if (!r) return;
        r.completedTests = completed;
        r.successfulTests = successful;
        r.failedTests = failed;
      }),
      addTestResult: jest.fn((testResult) => {
        if (!testResult.testRunId) return;
        results[testResult.testRunId] = results[testResult.testRunId] || [];
        results[testResult.testRunId].push(testResult);
      }),
      getTestRunResults: jest.fn((id) => {
        return results[id] || [];
      }),
      getConfig: jest.fn(() => ({ maxParallelTests: 1, testDuration: 1 }))
    };

    // Mock Jellyfin client with fast, deterministic behavior
    mockJellyfinClient = {
      getItem: jest.fn(async (itemId) => ({ Id: itemId, Name: 'Test Movie', Container: 'mp4', Path: '/media/test.mp4' })),
      startPlaybackSession: jest.fn(async () => ({ MediaSources: [{ Id: 'source-1' }], PlaySessionId: 'ps-1' })),
      getStreamUrl: jest.fn((itemId, mediaSourceId, deviceId, opts) => `http://dummy/${itemId}/master.m3u8`),
      downloadHlsStream: jest.fn(async (masterUrl, durationSeconds = 1, onProgress = null) => {
        // Simulate a quick download and progress callbacks
        if (onProgress) onProgress({ totalBytes: 1024, bytesThisSecond: 1024, elapsedSeconds: 1 });
        return { success: true, bytesDownloaded: 1024, segmentsDownloaded: 1 };
      }),
      stopPlayback: jest.fn(async () => {}),
      reportPlaybackStarted: jest.fn(async () => {}),
      reportPlaybackProgress: jest.fn(async () => {})
    };

    testRunner = new TestRunner(mockJellyfinClient, mockDb);
    testRunManager = new TestRunManager(mockDb, testRunner, mockJellyfinClient);

    // Wire runner->manager events as the server does
    testRunner.on('testCompleted', (data) => {
      try {
        if (data.testRunId) testRunManager.onTestComplete(data);
      } catch (err) {
        // ignore in test
      }
    });
  });

  test('completes a simple single-device single-item run', async () => {
    // Create a run with one device and one media item (1 test expected)
    const config = {
      devices: [{ id: 1, name: 'Device 1', deviceId: 'dev-1', maxBitrate: 20000000, audioCodec: 'aac', videoCodec: 'h264' }],
      mediaItems: [{ Id: 'item-1', Name: 'Test Movie', Path: '/media/test.mp4' }]
    };

    const created = testRunManager.createTestRun(config);
    expect(created).toHaveProperty('id');

    const completion = new Promise((resolve, reject) => {
      const to = setTimeout(() => reject(new Error('Test run did not complete within timeout')), 5000);
      testRunManager.on('testRunCompleted', (d) => {
        clearTimeout(to);
        resolve(d);
      });
    });

    // Start the run
    await testRunManager.startTestRun(created.id);

    const completedEvent = await completion;
    expect(completedEvent).toHaveProperty('id', created.id);

    const run = mockDb.getTestRun(created.id);
    expect(run.status).toBe('completed');

    const results = mockDb.getTestRunResults(created.id);
    expect(results.length).toBeGreaterThanOrEqual(1);
    expect(results[0]).toHaveProperty('itemId', 'item-1');
    expect(results[0]).toHaveProperty('success', true);
  });
});

