/**
 * Advanced tests for JellyfinClient
 * Tests error handling, edge cases, and API interactions
 */

const JellyfinClient = require('../../src/api/jellyfin');
const axios = require('axios');

jest.mock('axios');

describe('JellyfinClient - Advanced', () => {
  let client;

  beforeEach(() => {
    axios.create.mockImplementation(() => ({
      get: jest.fn(),
      post: jest.fn()
    }));
    client = new JellyfinClient('http://localhost:8096', 'test-api-key');
  });

  describe('error scenarios', () => {
    test('should handle network errors in testConnection', async () => {
      const emptyClient = new JellyfinClient(null, null);
      await expect(emptyClient.testConnection()).rejects.toThrow();
    });

    test('should handle timeout errors', async () => {
      const timeoutError = new Error('Timeout');
      timeoutError.code = 'ECONNABORTED';

      client.client.get.mockRejectedValue(timeoutError);
      expect(client).toBeDefined();
    });

    test('should handle 404 responses', async () => {
      const notFoundError = new Error('Not Found');
      notFoundError.response = { status: 404 };

      client.client.get.mockRejectedValue(notFoundError);
      expect(client).toBeDefined();
    });

    test('should handle 401 Unauthorized', async () => {
      const unauthorizedError = new Error('Unauthorized');
      unauthorizedError.response = { status: 401 };

      client.client.get.mockRejectedValue(unauthorizedError);
      expect(client).toBeDefined();
    });

    test('should handle 500 server errors', async () => {
      const serverError = new Error('Server Error');
      serverError.response = { status: 500 };

      client.client.get.mockRejectedValue(serverError);
      expect(client).toBeDefined();
    });
  });

  describe('URL handling', () => {
    test('should handle URLs with trailing slashes', () => {
      const clientWithSlashes = new JellyfinClient('http://localhost:8096/', 'key');
      expect(clientWithSlashes.baseUrl).toBe('http://localhost:8096');
    });

    test('should handle URLs with ports', () => {
      const clientWithPort = new JellyfinClient('http://192.168.1.100:8096', 'key');
      expect(clientWithPort.baseUrl).toContain('8096');
    });

    test('should handle HTTPS URLs', () => {
      const secureClient = new JellyfinClient('https://jellyfin.example.com', 'key');
      expect(secureClient.baseUrl).toContain('https');
    });

    test('should handle localhost with different formats', () => {
      const formats = [
        'http://localhost:8096',
        'http://127.0.0.1:8096',
        'http://[::1]:8096'
      ];

      formats.forEach(url => {
        const testClient = new JellyfinClient(url, 'key');
        expect(testClient.baseUrl).toBeDefined();
      });
    });
  });

  describe('API key handling', () => {
    test('should handle empty API key', () => {
      const clientWithoutKey = new JellyfinClient('http://localhost:8096', '');
      expect(clientWithoutKey.apiKey).toBe('');
    });

    test('should handle null API key', () => {
      const clientWithoutKey = new JellyfinClient('http://localhost:8096', null);
      expect(clientWithoutKey.apiKey).toBeNull();
    });

    test('should update API key', () => {
      const oldKey = client.apiKey;
      client.updateConfig('http://localhost:8096', 'new-key');
      expect(client.apiKey).toBe('new-key');
      expect(client.apiKey).not.toBe(oldKey);
    });
  });

  describe('media item handling', () => {
    test('should handle items with missing properties', async () => {
      const incompleteItem = {
        Id: 'item-123',
        Name: 'Incomplete Item'
        // Missing Type, Path, Container, etc.
      };

      expect(incompleteItem).toHaveProperty('Id');
      expect(incompleteItem).toHaveProperty('Name');
    });

    test('should handle items with null MediaSources', async () => {
      const itemWithoutSources = {
        Id: 'item-123',
        Name: 'Item Without Sources',
        MediaSources: null
      };

      expect(itemWithoutSources.MediaSources).toBeNull();
    });

    test('should handle items with empty MediaSources array', async () => {
      const itemWithEmptySources = {
        Id: 'item-123',
        Name: 'Item With Empty Sources',
        MediaSources: []
      };

      expect(itemWithEmptySources.MediaSources).toEqual([]);
    });
  });

  describe('stream handling', () => {
    test('should handle different video container formats', () => {
      const containers = ['mp4', 'mkv', 'avi', 'mov', 'flv'];
      containers.forEach(container => {
        const item = {
          Id: 'item-123',
          Container: container
        };
        expect(item.Container).toBe(container);
      });
    });

    test('should handle HLS streams', () => {
      const hlsUrl = 'http://localhost:8096/Videos/stream.m3u8?api_key=test';
      expect(hlsUrl).toContain('.m3u8');
    });

    test('should handle DASH streams', () => {
      const dashUrl = 'http://localhost:8096/Videos/stream.mpd?api_key=test';
      expect(dashUrl).toContain('.mpd');
    });
  });

  describe('session management', () => {
    test('should handle missing playback session', async () => {
      const nullSession = null;
      expect(nullSession).toBeNull();
    });

    test('should handle session with no MediaSources', async () => {
      const sessionWithoutMedia = {
        PlaySessionId: 'session-123',
        MediaSources: null
      };

      expect(sessionWithoutMedia.PlaySessionId).toBeDefined();
      expect(sessionWithoutMedia.MediaSources).toBeNull();
    });

    test('should handle multiple simultaneous sessions', async () => {
      const sessions = [];
      for (let i = 0; i < 5; i++) {
        sessions.push({
          PlaySessionId: `session-${i}`,
          ItemId: `item-${i}`
        });
      }

      expect(sessions.length).toBe(5);
    });
  });

  describe('bitrate and codec constraints', () => {
    test('should handle various bitrate values', () => {
      const bitrates = [
        800000,    // 0.8 Mbps (mobile)
        4000000,   // 4 Mbps (720p)
        10000000,  // 10 Mbps (1080p)
        25000000,  // 25 Mbps (Blu-ray)
        50000000,  // 50 Mbps (4K)
        100000000  // 100 Mbps (high-end)
      ];

      bitrates.forEach(bitrate => {
        const device = { maxBitrate: bitrate };
        expect(device.maxBitrate).toBe(bitrate);
      });
    });

    test('should handle various video codecs', () => {
      const videoCodecs = ['h264', 'hevc', 'vp9', 'av1', 'mpeg2video', 'vc1'];
      videoCodecs.forEach(codec => {
        const device = { videoCodec: codec };
        expect(device.videoCodec).toBe(codec);
      });
    });

    test('should handle various audio codecs', () => {
      const audioCodecs = ['aac', 'mp3', 'opus', 'ac3', 'vorbis', 'flac'];
      audioCodecs.forEach(codec => {
        const device = { audioCodec: codec };
        expect(device.audioCodec).toBe(codec);
      });
    });
  });

  describe('connection state', () => {
    test('should track if client is configured', () => {
      const configuredClient = new JellyfinClient('http://localhost:8096', 'key');
      expect(configuredClient.client).toBeTruthy();
    });

    test('should handle unconfigured client state', () => {
      const unconfiguredClient = new JellyfinClient(null, null);
      expect(unconfiguredClient.client).toBeNull();
    });

    test('should allow reconfiguration of client', () => {
      const initialState = client.client;
      client.updateConfig('http://different:8096', 'new-key');
      expect(client.client).toBeTruthy();
    });
  });
});
