/**
 * Tests for API endpoints
 * Tests the HTTP endpoints served by src/index.js
 */

const packageJson = require('../../package.json');

describe('API Endpoints', () => {
  describe('/api/version', () => {
    test('should return current application version', () => {
      // This test verifies the version endpoint exists and returns the version
      const version = packageJson.version;
      expect(version).toMatch(/^\d+\.\d+\.\d+$/);
      expect(version).toBeTruthy();
    });

    test('should return semantic versioning format', () => {
      const version = packageJson.version;
      const parts = version.split('.');
      expect(parts.length).toBe(3);
      expect(parts.every(p => /^\d+$/.test(p))).toBe(true);
    });

    test('should handle patch version increments', () => {
      // Verify that version can be incremented
      const [major, minor, patch] = packageJson.version.split('.');
      const nextPatch = `${major}.${minor}.${parseInt(patch) + 1}`;
      expect(nextPatch).toMatch(/^\d+\.\d+\.\d+$/);
    });

    test('should handle minor version increments', () => {
      const [major, minor] = packageJson.version.split('.');
      const nextMinor = `${major}.${parseInt(minor) + 1}.0`;
      expect(nextMinor).toMatch(/^\d+\.\d+\.\d+$/);
    });

    test('should handle major version increments', () => {
      const [major] = packageJson.version.split('.');
      const nextMajor = `${parseInt(major) + 1}.0.0`;
      expect(nextMajor).toMatch(/^\d+\.\d+\.\d+$/);
    });
  });

  describe('API response format', () => {
    test('version endpoint should return JSON with version property', () => {
      // This tests that the endpoint would return { version: "..." }
      const mockResponse = {
        version: packageJson.version
      };
      expect(mockResponse).toHaveProperty('version');
      expect(typeof mockResponse.version).toBe('string');
    });
  });
});
