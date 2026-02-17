const LibraryScanner = require('../../src/services/scanner');
const EventEmitter = require('events');

describe('LibraryScanner', () => {
  let scanner;
  let mockJellyfinClient;
  let mockDb;
  beforeEach(() => {
    mockJellyfinClient = {
      getNewItems: jest.fn()
    };

    mockDb = { close: jest.fn(),
      getConfig: jest.fn().mockReturnValue({
        scanLibraryId: 'lib-123',
        scanInterval: 300,
        testDuration: 30,
        formats: ['mp4', 'mkv']
      }),
      getScanState: jest.fn().mockReturnValue({
        lastScanTime: new Date('2024-01-01').toISOString(),
        itemsQueued: 0
      }),
      updateScanState: jest.fn(),
      getAllDevices: jest.fn().mockReturnValue([
        { id: 1, name: 'Device 1' }
      ])
    };

    scanner = new LibraryScanner(mockJellyfinClient, mockDb);
  });

  afterEach(() => {
    scanner.stop();
    if (mockDb.close) mockDb.close();
  });

  describe('initialization', () => {
    test('should extend EventEmitter', () => {
      expect(scanner).toBeInstanceOf(EventEmitter);
    });

    test('should initialize with null cronJob', () => {
      expect(scanner.cronJob).toBeNull();
      expect(scanner.isScanning).toBe(false);
    });
  });

  describe('start', () => {
    test('should not start without library ID', () => {
      mockDb.getConfig.mockReturnValue({ scanLibraryId: null });
      scanner.start();
      expect(scanner.cronJob).toBeNull();
    });

    test('should not start without scan interval', () => {
      mockDb.getConfig.mockReturnValue({ 
        scanLibraryId: 'lib-123',
        scanInterval: null 
      });
      scanner.start();
      expect(scanner.cronJob).toBeNull();
    });
  });

  describe('stop', () => {
    test('should handle stop when not running', () => {
      expect(() => scanner.stop()).not.toThrow();
      expect(scanner.cronJob).toBeNull();
    });
  });

  describe('getStatus', () => {
    test('should return current status', () => {
      const status = scanner.getStatus();
      expect(status).toHaveProperty('isRunning');
      expect(status).toHaveProperty('isScanning');
    });

    test('should reflect not running state', () => {
      const status = scanner.getStatus();
      expect(status.isRunning).toBe(false);
    });
  });
});
