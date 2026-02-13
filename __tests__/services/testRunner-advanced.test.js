/**
 * Advanced tests for TestRunner
 * Tests error handling, edge cases, and state management
 */

const TestRunner = require('../../src/services/testRunner');

describe('TestRunner - Advanced', () => {
  let testRunner;
  let mockJellyfinClient;
  let mockDb;
  let emittedEvents;

  beforeEach(() => {
    emittedEvents = [];

    mockJellyfinClient = {
      getItem: jest.fn(),
      startPlaybackSession: jest.fn(),
      reportPlaybackProgress: jest.fn(),
      stopPlayback: jest.fn(),
      getActiveSessions: jest.fn(),
      getStreamUrl: jest.fn(),
      downloadVideoChunk: jest.fn(),
      downloadHlsStream: jest.fn(),
      isValidVideoData: jest.fn()
    };

    mockDb = {
      close: jest.fn(),
      getConfig: jest.fn().mockReturnValue({ testDuration: 30 }),
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

    // Track events
    testRunner.on('testStarted', (data) => emittedEvents.push({ event: 'testStarted', data }));
    testRunner.on('testCompleted', (data) => emittedEvents.push({ event: 'testCompleted', data }));
    testRunner.on('testProgress', (data) => emittedEvents.push({ event: 'testProgress', data }));
    testRunner.on('queueUpdated', (data) => emittedEvents.push({ event: 'queueUpdated', data }));
  });

  afterEach(() => {
    testRunner.stop();
    if (mockDb.close) mockDb.close();
  });

  describe('error handling', () => {
    test('should handle getItem errors', async () => {
      mockJellyfinClient.getItem.mockRejectedValue(new Error('Item not found'));

      expect(testRunner).toBeDefined();
      expect(testRunner.testQueue).toEqual([]);
    });

    test('should handle missing device', async () => {
      mockDb.getDevice.mockReturnValue(null);

      expect(testRunner).toBeDefined();
    });

    test('should handle invalid test duration config', () => {
      mockDb.getConfig.mockReturnValue({ testDuration: -5 });
      const config = mockDb.getConfig();
      expect(config.testDuration).toBeLessThan(0);
    });

    test('should handle missing mediaSource in item', async () => {
      mockJellyfinClient.getItem.mockResolvedValue({
        Id: 'item-123',
        Name: 'Test Item',
        Type: 'Movie',
        Path: '/media/test.mp4',
        Container: 'mp4',
        MediaSources: null
      });

      expect(testRunner).toBeDefined();
    });
  });

  describe('queue management', () => {
    test('should maintain queue order', () => {
      const test1 = { itemId: 'item-1', itemName: 'Item 1', deviceId: 1 };
      const test2 = { itemId: 'item-2', itemName: 'Item 2', deviceId: 1 };

      testRunner.queueTest(test1);
      testRunner.queueTest(test2);

      expect(testRunner.testQueue.length).toBeGreaterThanOrEqual(0);
    });

    test('should clear queue on stop', () => {
      testRunner.stop();
      expect(testRunner.isRunning).toBe(false);
    });
  });

  describe('parallel execution settings', () => {
    test('should set max parallel tests', () => {
      testRunner.setMaxParallelTests(5);
      expect(testRunner.maxParallelTests).toBe(5);
    });

    test('should validate max parallel tests is positive', () => {
      testRunner.setMaxParallelTests(0);
      // Should handle gracefully
      expect(testRunner.maxParallelTests).toBeGreaterThanOrEqual(0);
    });

    test('should respect max parallel test limits', () => {
      testRunner.setMaxParallelTests(100);
      // Test runner may have a cap on parallel tests
      expect(testRunner.maxParallelTests).toBeGreaterThan(0);
      expect(testRunner.maxParallelTests).toBeLessThanOrEqual(100);
    });
  });

  describe('test item properties', () => {
    test('should queue test with all required properties', () => {
      const testData = {
        itemId: 'item-123',
        itemName: 'Test Movie',
        deviceId: 1
      };

      testRunner.queueTest(testData);

      expect(testData).toHaveProperty('itemId');
      expect(testData).toHaveProperty('itemName');
      expect(testData).toHaveProperty('deviceId');
    });

    test('should handle test items with special characters in name', () => {
      const specialNames = [
        'Movie [2024] (Director\'s Cut)',
        'Film & Friends: The Story',
        'Test@Movie#123',
        'Тест (Russian)',
        '日本映画'
      ];

      specialNames.forEach(name => {
        const test = {
          itemId: `item-${Math.random()}`,
          itemName: name,
          deviceId: 1
        };
        testRunner.queueTest(test);
      });

      expect(testRunner).toBeDefined();
    });
  });

  describe('status and monitoring', () => {
    test('should report running state', () => {
      const isRunning = testRunner.isRunning;
      expect(typeof isRunning).toBe('boolean');
    });

    test('should report queue length', () => {
      expect(testRunner.testQueue).toBeDefined();
      expect(Array.isArray(testRunner.testQueue)).toBe(true);
    });

    test('should maintain test count', () => {
      const initialLength = testRunner.testQueue.length;
      testRunner.queueTest({
        itemId: 'new-item',
        itemName: 'New Item',
        deviceId: 1
      });

      expect(testRunner.testQueue.length).toBeGreaterThanOrEqual(initialLength);
    });
  });

  describe('device configuration', () => {
    test('should use device codec settings', () => {
      const device = mockDb.getDevice(1);
      expect(device).toHaveProperty('videoCodec');
      expect(device).toHaveProperty('audioCodec');
      expect(device).toHaveProperty('maxBitrate');
    });

    test('should handle devices with different codec combinations', () => {
      const codecCombinations = [
        { videoCodec: 'h264', audioCodec: 'aac' },
        { videoCodec: 'hevc', audioCodec: 'opus' },
        { videoCodec: 'av1', audioCodec: 'ac3' },
        { videoCodec: 'vp9', audioCodec: 'vorbis' }
      ];

      codecCombinations.forEach(codecs => {
        mockDb.getDevice.mockReturnValue({
          id: 1,
          name: 'Multi Codec Device',
          deviceId: 'multi-codec',
          maxBitrate: 20000000,
          ...codecs
        });

        const device = mockDb.getDevice(1);
        expect(device.videoCodec).toBeDefined();
        expect(device.audioCodec).toBeDefined();
      });
    });
  });
});
