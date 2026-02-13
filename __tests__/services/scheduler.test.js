const Scheduler = require('../../src/services/scheduler');
const EventEmitter = require('events');

describe('Scheduler', () => {
  let scheduler;
  let mockDb;
  let mockJellyfinClient;
  let mockTestRunManager;

  beforeEach(() => {
    mockDb = { close: jest.fn(),
      getEnabledScheduledRuns: jest.fn(),
      updateScheduledRun: jest.fn(),
      getAllDevices: jest.fn(),
      createTestRun: jest.fn().mockReturnValue(123)
    };
    mockJellyfinClient = {
      getLibraryItems: jest.fn(),
      getRecentLibraryItems: jest.fn()
    };
    mockTestRunManager = {
      testRunner: {
        setMaxParallelTests: jest.fn()
      },
      createTestRun: jest.fn().mockReturnValue({ id: 123 }),
      startTestRun: jest.fn().mockResolvedValue({ success: true })
    };

    scheduler = new Scheduler(mockDb, mockJellyfinClient, mockTestRunManager);
    jest.useFakeTimers();
  });

  afterEach(() => {
    scheduler.stop();
    if (mockDb.close) mockDb.close();
    jest.useRealTimers();
  });

  describe('computeNextRun', () => {
    test('should compute next daily run for tomorrow if time has passed', () => {
      const now = new Date();
      now.setHours(10, 0, 0, 0);
      jest.setSystemTime(now);
      
      const next = Scheduler.computeNextRun('daily', null, '08:00');
      const nextDate = new Date(next);
      
      const tomorrow = new Date(now);
      tomorrow.setDate(now.getDate() + 1);
      tomorrow.setHours(8, 0, 0, 0);
      
      expect(nextDate.getTime()).toBe(tomorrow.getTime());
    });

    test('should compute next daily run for today if time is in future', () => {
      const now = new Date();
      now.setHours(6, 0, 0, 0);
      jest.setSystemTime(now);
      
      const next = Scheduler.computeNextRun('daily', null, '08:00');
      const nextDate = new Date(next);
      
      const today = new Date(now);
      today.setHours(8, 0, 0, 0);
      
      expect(nextDate.getTime()).toBe(today.getTime());
    });

    test('should compute weekly run correctly', () => {
      // 2026-02-13 is Friday
      const now = new Date('2026-02-13T10:00:00');
      jest.setSystemTime(now);
      
      // Request Monday (day 1) at 02:00
      const next = Scheduler.computeNextRun('weekly', 1, '02:00');
      const nextDate = new Date(next);
      
      // Should be next Monday (Feb 16)
      expect(nextDate.getMonth()).toBe(1); // Feb
      expect(nextDate.getDate()).toBe(16);
      expect(nextDate.getHours()).toBe(2);
    });
  });

  describe('_tick', () => {
    test('should execute schedule if nextRunAt is in the past', async () => {
      const pastDate = new Date(Date.now() - 1000).toISOString();
      const schedule = {
        id: 1,
        name: 'Daily Test',
        frequency: 'daily',
        timeOfDay: '02:00',
        nextRunAt: pastDate,
        deviceIds: [1],
        libraryIds: ['lib1'],
        mediaScope: 'all'
      };

      mockDb.getEnabledScheduledRuns.mockReturnValue([schedule]);
      mockDb.getAllDevices.mockReturnValue([{ id: 1, name: 'Phone' }]);

      // Mock item resolution
      mockJellyfinClient.getLibraryItems.mockResolvedValue({
        items: [{ Id: 'item1', Name: 'Movie' }],
        totalCount: 1
      });

      await scheduler._tick();

      expect(mockTestRunManager.createTestRun).toHaveBeenCalled();
      expect(mockTestRunManager.startTestRun).toHaveBeenCalledWith(123);
      expect(mockDb.updateScheduledRun).toHaveBeenCalledWith(1, expect.objectContaining({
        lastRunAt: expect.any(String),
        nextRunAt: expect.any(String)
      }));
    });

    test('should not execute if nextRunAt is in the future', async () => {
      const futureDate = new Date(Date.now() + 100000).toISOString();
      const schedule = {
        id: 1,
        nextRunAt: futureDate
      };

      mockDb.getEnabledScheduledRuns.mockReturnValue([schedule]);
      
      await scheduler._tick();

      expect(mockTestRunManager.startTestRun).not.toHaveBeenCalled();
    });
  });
});
