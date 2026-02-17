const TestRunManager = require('../../src/services/testRunManager');
const EventEmitter = require('events');

describe('TestRunManager', () => {
  let testRunManager;
  let mockDb;
  let mockTestRunner;

  beforeEach(() => {
    // Mock database
    mockDb = { close: jest.fn(),
      createTestRun: jest.fn().mockReturnValue(1),
      getTestRun: jest.fn(),
      updateTestRun: jest.fn(),
      updateTestRunProgress: jest.fn(),
      getConfig: jest.fn().mockReturnValue({ maxParallelTests: 2 })
    };

    // Mock test runner
    mockTestRunner = new EventEmitter();
    mockTestRunner.addTestToQueue = jest.fn();
    mockTestRunner.clearQueue = jest.fn();
    mockTestRunner.processQueue = jest.fn();
    mockTestRunner.setMaxParallelTests = jest.fn();
    mockTestRunner.pause = jest.fn();
    mockTestRunner.resume = jest.fn();
    mockTestRunner.cancel = jest.fn();

    // Mock Jellyfin client
    const mockJellyfinClient = {
      getLibraryItems: jest.fn(),
      getRecentLibraryItems: jest.fn(),
      getItem: jest.fn()
    };

    testRunManager = new TestRunManager(mockDb, mockTestRunner, mockJellyfinClient);
  });

  afterEach(() => {
    if (mockDb.close) mockDb.close();
  });

  describe('createTestRun', () => {
    test('should create test run with totalTests', () => {
      const config = {
        devices: [{ id: 1 }],
        mediaItems: [{ Id: 'item1' }, { Id: 'item2' }],
        totalTests: 2
      };

      const result = testRunManager.createTestRun(config);

      expect(result).toHaveProperty('id', 1);
      expect(result).toHaveProperty('totalTests', 2);
      expect(result).toHaveProperty('completedTests', 0);
      expect(result).toHaveProperty('successfulTests', 0);
      expect(result).toHaveProperty('failedTests', 0);
    });

    test('should emit testRunCreated event', (done) => {
      testRunManager.on('testRunCreated', (data) => {
        expect(data).toHaveProperty('id', 1);
        expect(data).toHaveProperty('name');
        done();
      });

      const config = { totalTests: 5 };
      testRunManager.createTestRun(config);
    });
  });

  describe('startTestRun', () => {
    beforeEach(() => {
      mockDb.getTestRun.mockReturnValue({
        id: 1,
        status: 'pending',
        config: {
          devices: [{ id: 1, name: 'Device 1' }],
          mediaItems: [
            { Id: 'item1', Name: 'Movie 1' },
            { Id: 'item2', Name: 'Episode', Type: 'Episode', SeriesName: 'Show', ParentIndexNumber: 1, IndexNumber: 2 }
          ],
          testConfig: { duration: 30, seekTest: true }
        }
      });
    });

    test('should format TV episode names correctly', async () => {
      await testRunManager.startTestRun(1);

      expect(mockTestRunner.addTestToQueue).toHaveBeenCalledTimes(2);
      
      // Order is randomized, find the episode call
      const calls = mockTestRunner.addTestToQueue.mock.calls.map(c => c[0]);
      const episodeCall = calls.find(c => c.itemName.includes('Episode'));
      expect(episodeCall.itemName).toBe('Show S1E2 - Episode');
    });

    test('should preserve movie names', async () => {
      await testRunManager.startTestRun(1);

      const calls = mockTestRunner.addTestToQueue.mock.calls.map(c => c[0]);
      const movieCall = calls.find(c => c.itemName === 'Movie 1');
      expect(movieCall.itemName).toBe('Movie 1');
    });

    test('should set maxParallelTests from config', async () => {
      await testRunManager.startTestRun(1);

      expect(mockTestRunner.setMaxParallelTests).toHaveBeenCalledWith(2);
      expect(mockTestRunner.processQueue).toHaveBeenCalledTimes(1);
    });
  });

  describe('onTestComplete', () => {
    beforeEach(() => {
      testRunManager.currentRunId = 1;
      mockDb.getTestRun.mockReturnValue({
        id: 1,
        totalTests: 5,
        completedTests: 3,
        successfulTests: 2,
        failedTests: 1
      });
    });

    test('should emit progress update for every test', (done) => {
      const progressEvents = [];
      testRunManager.on('testRunProgress', (data) => {
        progressEvents.push(data);
      });

      testRunManager.onTestComplete({ success: true });

      // Check that progress was emitted
      expect(progressEvents.length).toBe(1);
      expect(progressEvents[0]).toEqual({
        id: 1,
        completed: 4,
        total: 5,
        successful: 3,
        failed: 1
      });
      done();
    });

    test('should emit progress at 100% then completion', (done) => {
      mockDb.getTestRun.mockReturnValue({
        id: 1,
        totalTests: 5,
        completedTests: 4, // This will be the 5th test
        successfulTests: 4,
        failedTests: 0
      });

      const events = [];
      testRunManager.on('testRunProgress', (data) => {
        events.push({ type: 'progress', data });
      });
      testRunManager.on('testRunCompleted', (data) => {
        events.push({ type: 'completed', data });
        
        // Verify progress came BEFORE completion
        expect(events.length).toBe(2);
        expect(events[0].type).toBe('progress');
        expect(events[0].data.completed).toBe(5);
        expect(events[0].data.total).toBe(5);
        expect(events[1].type).toBe('completed');
        done();
      });

      testRunManager.onTestComplete({ success: true });
    });

    test('should update database with progress', () => {
      testRunManager.onTestComplete({ success: true });

      expect(mockDb.updateTestRunProgress).toHaveBeenCalledWith(1, 4, 3, 1);
    });

    test('should increment successful count on success', () => {
      testRunManager.onTestComplete({ success: true });

      expect(mockDb.updateTestRunProgress).toHaveBeenCalledWith(
        1,
        4, // completed
        3, // successful (was 2, now 3)
        1  // failed (unchanged)
      );
    });

    test('should increment failed count on failure', () => {
      testRunManager.onTestComplete({ success: false });

      expect(mockDb.updateTestRunProgress).toHaveBeenCalledWith(
        1,
        4, // completed
        2, // successful (unchanged)
        2  // failed (was 1, now 2)
      );
    });
  });
});
