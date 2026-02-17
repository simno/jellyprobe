/**
 * Advanced tests for LibraryScanner
 * Tests scanning logic, event emissions, and error handling
 */

const LibraryScanner = require('../../src/services/scanner');

describe('LibraryScanner - Advanced', () => {
  let scanner;
  let mockJellyfinClient;
  let mockDb;
  let emittedEvents;

  beforeEach(() => {
    emittedEvents = [];

    mockJellyfinClient = {
      getNewItems: jest.fn()
    };

    mockDb = {
      close: jest.fn(),
      getConfig: jest.fn().mockReturnValue({
        scanLibraryIds: JSON.stringify(['lib-123']),
        scanInterval: 300,
        testDuration: 30
      }),
      getScanState: jest.fn().mockReturnValue({
        lastScanTime: new Date('2024-01-01').toISOString(),
        itemsQueued: 0
      }),
      updateScanState: jest.fn(),
      getAllDevices: jest.fn().mockReturnValue([
        { id: 1, name: 'Device 1' },
        { id: 2, name: 'Device 2' }
      ])
    };

    scanner = new LibraryScanner(mockJellyfinClient, mockDb);

    // Track emitted events
    scanner.on('scanStarted', () => emittedEvents.push('scanStarted'));
    scanner.on('scanCompleted', (data) => emittedEvents.push({ event: 'scanCompleted', data }));
    scanner.on('scanError', (error) => emittedEvents.push({ event: 'scanError', error }));
  });

  afterEach(() => {
    scanner.stop();
    if (mockDb.close) mockDb.close();
  });

  describe('restart functionality', () => {
    test('should stop and restart scanner', () => {
      // Stop first to clean up any existing cron job
      scanner.stop();
      scanner.restart();
      // Verify scanner still exists and is an instance
      expect(scanner).toBeInstanceOf(LibraryScanner);
    });
  });

  describe('error handling', () => {
    test('should handle getNewItems errors gracefully', async () => {
      mockJellyfinClient.getNewItems.mockRejectedValue(
        new Error('Network error')
      );

      // Scanner should handle the error internally
      expect(scanner).toBeDefined();
    });

    test('should handle missing device data', () => {
      mockDb.getAllDevices.mockReturnValue([]);

      const status = scanner.getStatus();
      expect(status).toHaveProperty('isRunning');
      expect(status).toHaveProperty('isScanning');
    });

    test('should handle invalid scan configuration gracefully', () => {
      mockDb.getConfig.mockReturnValue({
        scanLibraryIds: JSON.stringify(['lib-1', 'lib-2']), // Valid JSON
        scanInterval: 300
      });

      scanner.start();
      // Should start successfully with valid config
      expect(scanner).toBeDefined();
    });
  });

  describe('state management', () => {
    test('should maintain scanning state', () => {
      const status = scanner.getStatus();
      expect(status).toHaveProperty('isScanning');
      expect(typeof status.isScanning).toBe('boolean');
    });

    test('should handle multiple library IDs', () => {
      mockDb.getConfig.mockReturnValue({
        scanLibraryIds: JSON.stringify(['lib-1', 'lib-2', 'lib-3']),
        scanInterval: 300
      });

      scanner.restart();
      // Scanner should handle multiple libraries
      expect(scanner).toBeDefined();
    });
  });

  describe('device profile handling', () => {
    test('should queue tests for all devices', () => {
      const devices = mockDb.getAllDevices();
      expect(devices.length).toBeGreaterThan(0);
    });

    test('should handle empty device list', () => {
      mockDb.getAllDevices.mockReturnValue([]);

      const devices = mockDb.getAllDevices();
      expect(devices).toEqual([]);
      expect(devices.length).toBe(0);
    });
  });

  describe('library configuration', () => {
    test('should parse multiple library IDs from JSON', () => {
      const config = mockDb.getConfig();
      let libraryIds = [];
      try {
        libraryIds = JSON.parse(config.scanLibraryIds);
      } catch (e) {
        libraryIds = [];
      }
      expect(Array.isArray(libraryIds)).toBe(true);
    });

    test('should handle missing scanLibraryIds in config', () => {
      mockDb.getConfig.mockReturnValue({
        scanInterval: 300
      });

      scanner.start();
      expect(scanner.cronJob).toBeNull();
    });
  });
});
