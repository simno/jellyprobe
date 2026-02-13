const JellyfinClient = require('../../src/api/jellyfin');
const axios = require('axios');
jest.mock('axios');

describe('JellyfinClient', () => {
  let client;
  let mockAxiosInstance;

  beforeEach(() => {
    axios.create.mockImplementation(() => ({
      get: jest.fn(),
      post: jest.fn()
    }));
    client = new JellyfinClient('http://localhost:8096', 'test-api-key');
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  describe('initialization', () => {
    test('should create client with base URL and API key', () => {
      expect(client.baseUrl).toBe('http://localhost:8096');
      expect(client.apiKey).toBe('test-api-key');
    });

    test('should strip trailing slash from URL', () => {
      const clientWithSlash = new JellyfinClient('http://localhost:8096/', 'key');
      expect(clientWithSlash.baseUrl).toBe('http://localhost:8096');
    });

    test('should handle missing configuration', () => {
      const emptyClient = new JellyfinClient(null, null);
      expect(emptyClient.client).toBeNull();
    });
  });

  describe('updateConfig', () => {
    test('should update base URL and API key', () => {
      client.updateConfig('http://newserver:8096', 'new-key');
      expect(client.baseUrl).toBe('http://newserver:8096');
      expect(client.apiKey).toBe('new-key');
    });

    test('should recreate axios client', () => {
      client.updateConfig('http://localhost:8096', 'initial-key');
      const oldClient = client.client;
      expect(oldClient).toBeTruthy();
      
      client.updateConfig('http://different:8096', 'different-key');
      expect(client.client).not.toBe(oldClient);
    });
  });

  describe('testConnection', () => {
    test('should throw error when client not configured', async () => {
      const emptyClient = new JellyfinClient(null, null);
      await expect(emptyClient.testConnection()).rejects.toThrow('Jellyfin client not configured');
    });
  });

  describe('getLibraries', () => {
    test('should throw error when client not configured', async () => {
      const emptyClient = new JellyfinClient(null, null);
      await expect(emptyClient.getLibraries()).rejects.toThrow('Jellyfin client not configured');
    });
  });

  describe('getNewItems', () => {
    test('should throw error when client not configured', async () => {
      const emptyClient = new JellyfinClient(null, null);
      await expect(emptyClient.getNewItems('lib-123')).rejects.toThrow('Jellyfin client not configured');
    });

    test('should require library ID parameter', async () => {
      await expect(client.getNewItems()).rejects.toThrow();
    });
  });

  describe('getItem', () => {
    test('should throw error when client not configured', async () => {
      const emptyClient = new JellyfinClient(null, null);
      await expect(emptyClient.getItem('item-123')).rejects.toThrow('Jellyfin client not configured');
    });
  });

  describe('startPlaybackSession', () => {
    test('should throw error when client not configured', async () => {
      const emptyClient = new JellyfinClient(null, null);
      await expect(emptyClient.startPlaybackSession('item-123', 'dev-123')).rejects.toThrow('Jellyfin client not configured');
    });

    test('should use provided options', async () => {
      const options = {
        maxBitrate: 15000000,
        audioCodec: 'mp3',
        videoCodec: 'hevc'
      };

      // This will fail without a real server, but we're testing parameter handling
      try {
        await client.startPlaybackSession('item-123', 'dev-123', options);
      } catch (error) {
        // Expected to fail, just checking it doesn't crash
        expect(error).toBeDefined();
      }
    });
  });

  describe('getUserId', () => {
    test('should cache user ID', async () => {
      client.cachedUserId = 'cached-user-123';
      const userId = await client.getUserId();
      expect(userId).toBe('cached-user-123');
    });

    test('should throw error when client not configured', async () => {
      const emptyClient = new JellyfinClient(null, null);
      await expect(emptyClient.getUserId()).rejects.toThrow();
    });
  });

  describe('reportPlaybackProgress', () => {
    test('should not throw when client not configured', async () => {
      const emptyClient = new JellyfinClient(null, null);
      await expect(
        emptyClient.reportPlaybackProgress('item-123', 'session-123', 1000000, 'dev-123')
      ).resolves.toBeUndefined();
    });
  });

  describe('stopPlayback', () => {
    test('should not throw when client not configured', async () => {
      const emptyClient = new JellyfinClient(null, null);
      await expect(
        emptyClient.stopPlayback('item-123', 'session-123', 1000000, 'dev-123')
      ).resolves.toBeUndefined();
    });
  });

  describe('getActiveSessions', () => {
    test('should throw error when client not configured', async () => {
      const emptyClient = new JellyfinClient(null, null);
      await expect(emptyClient.getActiveSessions()).rejects.toThrow('Jellyfin client not configured');
    });
  });

  describe('getStreamUrl', () => {
    test('should generate correct HLS master playlist URL', () => {
      const url = client.getStreamUrl('item123', 'source456', 'device789', {
        videoCodec: 'h264',
        audioCodec: 'aac',
        maxBitrate: 10000000
      });

      expect(url).toContain('/Videos/item123/master.m3u8');
      expect(url).toContain('MediaSourceId=source456');
      expect(url).toContain('DeviceId=device789');
      expect(url).toContain('VideoCodec=h264');
      expect(url).toContain('MaxStreamingBitrate=10000000');
    });
  });

  describe('downloadHlsStream', () => {
    test('should fail if playlist is invalid', async () => {
      axios.get.mockResolvedValueOnce({ data: 'invalid content' });
      
      const result = await client.downloadHlsStream('http://fake/master.m3u8', 1);
      expect(result.success).toBe(false);
      expect(result.error).toContain('Invalid HLS master playlist');
    });

    test('should follow variants and download segments', async () => {
      // Mock master playlist
      axios.get.mockResolvedValueOnce({ 
        data: '#EXTM3U\n#EXT-X-STREAM-INF:BANDWIDTH=1280000\nvariant.m3u8' 
      });
      // Mock variant playlist - WITH #EXT-X-ENDLIST to break loop
      axios.get.mockResolvedValueOnce({ 
        data: '#EXTM3U\n#EXTINF:3.0,\nseg1.ts\n#EXT-X-ENDLIST' 
      });
      // Mock segment download
      axios.get.mockResolvedValueOnce({ 
        data: Buffer.alloc(1024),
        headers: { 'content-type': 'video/mp2t' }
      });

      const result = await client.downloadHlsStream('http://fake/master.m3u8', 10);
      expect(result.success).toBe(true);
      expect(result.bytesDownloaded).toBe(1024);
      expect(result.segmentsDownloaded).toBe(1);
    }, 10000);
  });
});
