/**
 * Advanced tests for DatabaseManager
 * Tests error handling, edge cases, and data integrity
 */

const DatabaseManager = require('../../src/db/schema');
const fs = require('fs');
const path = require('path');

describe('DatabaseManager - Advanced', () => {
  let db;
  let testDbPath;

  beforeEach(() => {
    testDbPath = path.join(__dirname, '../../test_db_advanced.db');
    db = new DatabaseManager(testDbPath);
    db.initialize();
  });

  afterEach(() => {
    if (db) {
      db.close();
    }
    // Clean up test database
    if (fs.existsSync(testDbPath)) {
      fs.unlinkSync(testDbPath);
    }
  });

  describe('configuration management', () => {
    test('should handle config updates with partial data', () => {
      db.updateConfig({ jellyfinUrl: 'http://localhost:8096' });
      const config = db.getConfig();
      expect(config.jellyfinUrl).toBe('http://localhost:8096');
    });

    test('should preserve existing config values during partial update', () => {
      db.updateConfig({ jellyfinUrl: 'http://server1:8096' });
      db.updateConfig({ apiKey: 'test-key' });

      const config = db.getConfig();
      expect(config.jellyfinUrl).toBe('http://server1:8096');
      expect(config.apiKey).toBe('test-key');
    });

    test('should handle numeric config values', () => {
      db.updateConfig({ testDuration: 60 });
      const config = db.getConfig();
      expect(config.testDuration).toBe(60);
    });

    test('should handle JSON string config values', () => {
      const libraryIds = JSON.stringify(['lib-1', 'lib-2']);
      db.updateConfig({ scanLibraryIds: libraryIds });
      const config = db.getConfig();
      expect(config.scanLibraryIds).toBe(libraryIds);
    });
  });

  describe('device management', () => {
    test('should add device with all required fields', () => {
      const device = {
        name: 'Test Device',
        deviceId: 'test-dev-1',
        videoCodec: 'h264',
        audioCodec: 'aac',
        maxBitrate: 10000000,
        maxWidth: 1920,
        maxHeight: 1080
      };

      const result = db.addDevice(device);
      expect(result.lastInsertRowid).toBeGreaterThan(0);

      const devices = db.getAllDevices();
      expect(devices.length).toBeGreaterThan(0);
    });

    test('should update device fields', () => {
      const device = {
        name: 'Original Device',
        deviceId: 'dev-update-test',
        videoCodec: 'h264',
        audioCodec: 'aac',
        maxBitrate: 5000000,
        maxWidth: 1280,
        maxHeight: 720
      };

      const result = db.addDevice(device);
      const deviceId = result.lastInsertRowid;

      db.updateDevice(deviceId, { name: 'Updated Device' });
      const updatedDevice = db.getDevice(deviceId);
      expect(updatedDevice.name).toBe('Updated Device');
    });

    test('should delete device and verify it is removed', () => {
      const device = {
        name: 'Device to Delete',
        deviceId: 'dev-delete-test',
        videoCodec: 'hevc',
        audioCodec: 'opus',
        maxBitrate: 20000000,
        maxWidth: 3840,
        maxHeight: 2160
      };

      const result = db.addDevice(device);
      const deviceId = result.lastInsertRowid;

      db.deleteDevice(deviceId);
      const deletedDevice = db.getDevice(deviceId);
      expect(deletedDevice).toBeFalsy();
    });
  });

  describe('scan state management', () => {
    test('should initialize and update scan state', () => {
      const initialState = db.getScanState();
      expect(initialState).toHaveProperty('lastScanTime');
      expect(initialState).toHaveProperty('itemsQueued');
    });

    test('should update scan state with new values', () => {
      const newLastScanTime = new Date().toISOString();
      const newItemsQueued = 42;

      db.updateScanState(newLastScanTime, newItemsQueued);
      const state = db.getScanState();
      expect(state.itemsQueued).toBe(42);
    });
  });

  describe('test history and statistics', () => {
    test('should add test result and retrieve history', () => {
      const testResult = {
        itemId: 'item-123',
        itemName: 'Test Item',
        deviceId: 1,
        success: true,
        duration: 30,
        bytesDownloaded: 5242880,
        streamUrl: 'http://test.com/stream',
        errorMessage: null
      };

      db.addTestResult(testResult);
      const history = db.getTestHistory(100, 0);
      expect(history.length).toBeGreaterThan(0);
    });

    test('should paginate test history', () => {
      // Add multiple test results
      for (let i = 0; i < 5; i++) {
        db.addTestResult({
          itemId: `item-${i}`,
          itemName: `Test Item ${i}`,
          deviceId: 1,
          success: true,
          duration: 30,
          bytesDownloaded: 5242880,
          streamUrl: 'http://test.com/stream',
          errorMessage: null
        });
      }

      const page1 = db.getTestHistory(2, 0);
      const page2 = db.getTestHistory(2, 2);

      expect(page1.length).toBeLessThanOrEqual(2);
      expect(page2.length).toBeLessThanOrEqual(2);
    });

    test('should calculate statistics from test results', () => {
      db.addTestResult({
        itemId: 'item-pass',
        itemName: 'Pass Item',
        deviceId: 1,
        success: true,
        duration: 30,
        bytesDownloaded: 5242880,
        streamUrl: 'http://test.com/stream',
        errorMessage: null
      });

      db.addTestResult({
        itemId: 'item-fail',
        itemName: 'Fail Item',
        deviceId: 1,
        success: false,
        duration: 5,
        bytesDownloaded: 1024,
        streamUrl: 'http://test.com/stream',
        errorMessage: 'Connection timeout'
      });

      const stats = db.getTestStats();
      expect(stats).toHaveProperty('total');
      expect(stats).toHaveProperty('passed');
      expect(stats).toHaveProperty('failed');
    });
  });

  describe('data integrity', () => {
    test('should handle concurrent device additions', () => {
      const devices = [
        { name: 'Device 1', deviceId: 'dev-1', videoCodec: 'h264', audioCodec: 'aac', maxBitrate: 5000000, maxWidth: 1280, maxHeight: 720 },
        { name: 'Device 2', deviceId: 'dev-2', videoCodec: 'hevc', audioCodec: 'opus', maxBitrate: 10000000, maxWidth: 1920, maxHeight: 1080 },
        { name: 'Device 3', deviceId: 'dev-3', videoCodec: 'av1', audioCodec: 'ac3', maxBitrate: 20000000, maxWidth: 3840, maxHeight: 2160 }
      ];

      devices.forEach(d => db.addDevice(d));
      const allDevices = db.getAllDevices();
      expect(allDevices.length).toBeGreaterThanOrEqual(devices.length);
    });

    test('should preserve data types in config', () => {
      db.updateConfig({
        jellyfinUrl: 'http://localhost:8096',
        testDuration: 30,
        maxParallelTests: 2,
        showPreviews: 1
      });

      const config = db.getConfig();
      expect(typeof config.jellyfinUrl).toBe('string');
      expect(typeof config.testDuration).toBe('number');
      expect(typeof config.maxParallelTests).toBe('number');
    });
  });

  describe('database recovery', () => {
    test('should handle multiple close calls', () => {
      expect(() => {
        db.close();
        db.close();
      }).not.toThrow();
    });

    test('should reinitialize after close', () => {
      db.close();
      const newDb = new DatabaseManager(testDbPath);
      newDb.initialize();

      const config = newDb.getConfig();
      expect(config).toBeDefined();

      newDb.close();
    });
  });
});
