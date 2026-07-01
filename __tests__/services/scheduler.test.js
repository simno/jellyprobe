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

    test('should advance every6h schedule by 6h when time has passed', () => {
      const now = new Date();
      now.setHours(10, 0, 0, 0);
      jest.setSystemTime(now);

      const next = Scheduler.computeNextRun('every6h', null, '08:00');
      const nextDate = new Date(next);

      const expected = new Date(now);
      expected.setHours(8, 0, 0, 0);
      expected.setTime(expected.getTime() + 6 * 60 * 60 * 1000);
      expect(nextDate.getTime()).toBe(expected.getTime());
    });

    test('should never return a past time for interval schedules', () => {
      // 20:00 with an 01:00 anchor: a single +6h hop (07:00) would still be
      // in the past, which used to make the schedule fire on every tick.
      const now = new Date();
      now.setHours(20, 0, 0, 0);
      jest.setSystemTime(now);

      const next = new Date(Scheduler.computeNextRun('every6h', null, '01:00'));
      expect(next.getTime()).toBeGreaterThan(now.getTime());
      expect(next.getHours()).toBe(1); // 01:00 next day (01+6+6+6+6=25h → 01:00)
    });

    test('should advance every12h schedule by 12h when time has passed', () => {
      const now = new Date();
      now.setHours(10, 0, 0, 0);
      jest.setSystemTime(now);

      const next = Scheduler.computeNextRun('every12h', null, '08:00');
      const nextDate = new Date(next);

      const expected = new Date(now);
      expected.setHours(8, 0, 0, 0);
      expected.setTime(expected.getTime() + 12 * 60 * 60 * 1000);
      expect(nextDate.getTime()).toBe(expected.getTime());
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
      // The schedule's own parallelism must be passed through — startTestRun
      // would otherwise apply the global config value instead.
      expect(mockTestRunManager.startTestRun).toHaveBeenCalledWith(123, { maxParallelTests: 2 });
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
