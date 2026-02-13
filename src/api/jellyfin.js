const axios = require('axios');

class JellyfinClient {
  constructor(baseUrl, apiKey) {
    this.baseUrl = baseUrl?.replace(/\/$/, '');
    this.apiKey = apiKey;
    this.client = null;
    this.updateClient();
  }

  updateClient() {
    if (!this.baseUrl || !this.apiKey) {
      this.client = null;
      return;
    }

    this.client = axios.create({
      baseURL: this.baseUrl,
      headers: {
        'X-Emby-Token': this.apiKey,
        'X-Emby-Authorization': 'MediaBrowser Client="JellyProbe", Device="Docker", DeviceId="jellyprobe-1", Version="1.0.0"'
      },
      timeout: 30000
    });
  }

  updateConfig(baseUrl, apiKey) {
    this.baseUrl = baseUrl?.replace(/\/$/, '');
    this.apiKey = apiKey;
    this.client = null; // Reset to ensure updateClient creates a fresh instance
    this.updateClient();
  }

  async testConnection() {
    if (!this.client) {
      throw new Error('Jellyfin client not configured');
    }

    try {
      const response = await this.client.get('/System/Info');
      return {
        success: true,
        serverName: response.data.ServerName,
        version: response.data.Version
      };
    } catch (error) {
      return {
        success: false,
        error: error.message
      };
    }
  }

  async getLibraries() {
    if (!this.client) {
      throw new Error('Jellyfin client not configured');
    }

    try {
      const response = await this.client.get('/Library/VirtualFolders');
      return response.data;
    } catch (error) {
      throw new Error(`Failed to fetch libraries: ${error.message}`, { cause: error });
    }
  }

  async getNewItems(libraryId, dateAfter) {
    if (!this.client) {
      throw new Error('Jellyfin client not configured');
    }

    try {
      const params = {
        ParentId: libraryId,
        IncludeItemTypes: 'Movie,Episode',
        Recursive: true,
        Fields: 'Path,MediaSources,ProviderIds',
        SortBy: 'DateCreated',
        SortOrder: 'Descending'
      };

      if (dateAfter) {
        params.MinDateCreated = dateAfter;
      }

      const response = await this.client.get('/Items', { params });
      return response.data.Items || [];
    } catch (error) {
      throw new Error(`Failed to fetch new items: ${error.message}`, { cause: error });
    }
  }

  async getLibraryItems(libraryId, limit = 100, startIndex = 0, searchTerm = '') {
    if (!this.client) {
      throw new Error('Jellyfin client not configured');
    }

    try {
      const params = {
        ParentId: libraryId,
        IncludeItemTypes: 'Movie,Episode,Video',
        Recursive: true,
        Fields: 'Path,MediaSources,Overview,RunTimeTicks',
        SortBy: 'SortName',
        SortOrder: 'Ascending',
        Limit: limit,
        StartIndex: startIndex
      };
      if (searchTerm) params.SearchTerm = searchTerm;

      const response = await this.client.get('/Items', { params });
      return {
        items: response.data.Items || [],
        totalCount: response.data.TotalRecordCount || 0
      };
    } catch (error) {
      throw new Error(`Failed to fetch library items: ${error.message}`, { cause: error });
    }
  }

  async getRecentLibraryItems(libraryId, days = 7, limit = 100) {
    if (!this.client) {
      throw new Error('Jellyfin client not configured');
    }

    try {
      const cutoffDate = new Date();
      cutoffDate.setDate(cutoffDate.getDate() - days);
      const minDate = cutoffDate.toISOString();

      const params = {
        ParentId: libraryId,
        IncludeItemTypes: 'Movie,Episode,Video',
        Recursive: true,
        Fields: 'Path,MediaSources,Overview,RunTimeTicks,DateCreated',
        SortBy: 'DateCreated',
        SortOrder: 'Descending',
        Filters: 'IsNotFolder',
        MinDateCreated: minDate,
        Limit: limit
      };

      const response = await this.client.get('/Items', { params });
      
      // Jellyfin's TotalRecordCount doesn't respect MinDateCreated filter  
      const recentItems = (response.data.Items || []).filter(item => {
        if (!item.DateCreated) return false;
        const itemDate = new Date(item.DateCreated);
        return itemDate >= cutoffDate;
      });
      
      return {
        items: recentItems,
        totalCount: recentItems.length // Use filtered count, not Jellyfin's count
      };
    } catch (error) {
      throw new Error(`Failed to fetch recent library items: ${error.message}`, { cause: error });
    }
  }

  async getItem(itemId) {
    if (!this.client) {
      throw new Error('Jellyfin client not configured');
    }

    try {
      const response = await this.client.get(`/Users/${await this.getUserId()}/Items/${itemId}`);
      return response.data;
    } catch (error) {
      throw new Error(`Failed to fetch item: ${error.message}`, { cause: error });
    }
  }

  async getUserId() {
    if (this.cachedUserId) {
      return this.cachedUserId;
    }

    try {
      const response = await this.client.get('/Users');
      this.cachedUserId = response.data[0]?.Id;
      return this.cachedUserId;
    } catch (error) {
      throw new Error(`Failed to get user ID: ${error.message}`, { cause: error });
    }
  }

  async startPlaybackSession(itemId, deviceId, options = {}) {
    if (!this.client) {
      throw new Error('Jellyfin client not configured');
    }

    try {
      const userId = await this.getUserId();
      
      const params = {
        UserId: userId,
        StartTimeTicks: 0,
        IsPlayback: true,
        AutoOpenLiveStream: true,
        MediaSourceId: itemId,
        MaxStreamingBitrate: options.maxBitrate || 20000000,
        AudioCodec: options.audioCodec || 'aac',
        VideoCodec: options.videoCodec || 'h264',
        MaxWidth: options.maxWidth || 1920,
        MaxHeight: options.maxHeight || 1080,
        EnableDirectPlay: false,
        EnableDirectStream: false,
        EnableTranscoding: true
      };

      const response = await this.client.post(`/Items/${itemId}/PlaybackInfo`, params, {
        headers: {
          'X-Emby-Device-Id': deviceId,
          'X-Emby-Device-Name': 'JellyProbe'
        }
      });

      return response.data;
    } catch (error) {
      throw new Error(`Failed to start playback session: ${error.message}`, { cause: error });
    }
  }

  async reportPlaybackProgress(itemId, playSessionId, positionTicks, deviceId) {
    if (!this.client) {
      return;
    }

    try {
      await this.client.post('/Sessions/Playing/Progress', {
        ItemId: itemId,
        PlaySessionId: playSessionId,
        PositionTicks: positionTicks,
        IsPaused: false,
        IsMuted: false
      }, {
        headers: {
          'X-Emby-Device-Id': deviceId
        }
      });
    } catch (error) {
      console.error('Failed to report playback progress:', error.message);
    }
  }

  async stopPlayback(itemId, playSessionId, positionTicks, deviceId) {
    if (!this.client) {
      return;
    }

    try {
      await this.client.post('/Sessions/Playing/Stopped', {
        ItemId: itemId,
        PlaySessionId: playSessionId,
        PositionTicks: positionTicks
      }, {
        headers: {
          'X-Emby-Device-Id': deviceId
        }
      });
    } catch (error) {
      console.error('Failed to stop playback:', error.message);
    }
  }

  async getActiveSessions() {
    if (!this.client) {
      throw new Error('Jellyfin client not configured');
    }

    try {
      const response = await this.client.get('/Sessions');
      return response.data;
    } catch (error) {
      throw new Error(`Failed to get active sessions: ${error.message}`, { cause: error });
    }
  }

  // Get HLS master playlist URL for video playback (matches how real clients consume media)
  getStreamUrl(itemId, mediaSourceId, deviceId, options = {}) {
    const params = new URLSearchParams({
      MediaSourceId: mediaSourceId,
      DeviceId: deviceId,
      VideoCodec: options.videoCodec || 'h264',
      AudioCodec: options.audioCodec || 'aac',
      MaxStreamingBitrate: String(options.maxBitrate || 20000000),
      VideoBitrate: String(options.maxBitrate || 20000000),
      AudioBitrate: '128000',
      MaxWidth: String(options.maxWidth || 1920),
      MaxHeight: String(options.maxHeight || 1080),
      PlaySessionId: options.playSessionId || '',
      StartTimeTicks: String(options.startTimeTicks || 0),
      EnableAutoStreamCopy: 'false',
      AllowVideoStreamCopy: 'false',
      AllowAudioStreamCopy: 'false',
      EnableTranscoding: 'true',
      TranscodingProtocol: 'hls',
      SegmentContainer: 'mp4',
      MinSegments: '2',
      SegmentLength: '3',
      BreakOnNonKeyFrames: 'true'
    });

    return `${this.baseUrl}/Videos/${itemId}/master.m3u8?${params.toString()}`;
  }

  // Download and validate HLS stream to verify transcoding works
  async downloadHlsStream(masterUrl, durationSeconds = 30) {
    let totalBytes = 0;
    const authHeaders = { 'X-Emby-Token': this.apiKey };

    try {
      console.log(`[HLS] Starting stream validation (${durationSeconds}s)`);
      const masterResp = await axios.get(masterUrl, { timeout: 30000, headers: authHeaders });
      const masterText = masterResp.data;

      if (!masterText.includes('#EXTM3U')) {
        return { success: false, error: 'Invalid HLS master playlist', bytesDownloaded: 0 };
      }

      const lines = masterText.split('\n').map(l => l.trim()).filter(l => l && !l.startsWith('#'));
      if (lines.length === 0) {
        return { success: false, error: 'No variant streams in master playlist', bytesDownloaded: 0 };
      }

      let variantUrl = lines[0];
      if (!variantUrl.startsWith('http')) {
        variantUrl = new URL(variantUrl, masterUrl).toString();
      }

      const startTime = Date.now();
      const endTime = startTime + (durationSeconds * 1000);
      let downloadedSegments = new Set();
      let attempts = 0;
      const maxAttempts = durationSeconds * 2;

      while (Date.now() < endTime && attempts < maxAttempts) {
        attempts++;
        let variantText;
        try {
          const variantResp = await axios.get(variantUrl, { timeout: 15000, headers: authHeaders });
          variantText = variantResp.data;
        } catch (_e) {
          await new Promise(r => setTimeout(r, 2000));
          continue;
        }

        const segLines = variantText.split('\n').map(l => l.trim());
        const segments = segLines
          .filter(l => l && !l.startsWith('#'))
          .map(l => l.startsWith('http') ? l : new URL(l, variantUrl).toString());

        for (const segUrl of segments) {
          if (downloadedSegments.has(segUrl) || Date.now() >= endTime) continue;
          downloadedSegments.add(segUrl);

          try {
            const segResp = await axios.get(segUrl, {
              responseType: 'arraybuffer',
              timeout: 15000,
              headers: authHeaders
            });
            totalBytes += segResp.data.byteLength;
          } catch (e) {
            console.error(`[HLS] Segment download failed: ${e.message}`);
          }
        }

        if (downloadedSegments.size === 0) {
          await new Promise(r => setTimeout(r, 2000));
        } else if (variantText.includes('#EXT-X-ENDLIST')) {
          break;
        } else {
          await new Promise(r => setTimeout(r, 1500));
        }
      }

      if (totalBytes === 0) {
        return { success: false, error: 'No HLS segments downloaded — transcoding may have failed', bytesDownloaded: 0 };
      }

      console.log(`[HLS] Complete: ${downloadedSegments.size} segments, ${totalBytes} bytes`);
      return {
        success: true,
        data: Buffer.alloc(0),
        contentType: 'video/mp4',
        bytesDownloaded: totalBytes,
        segmentsDownloaded: downloadedSegments.size
      };
    } catch (error) {
      console.error(`[HLS] Error: ${error.message}`);
      return {
        success: false,
        error: error.message,
        bytesDownloaded: totalBytes
      };
    }
  }
}

module.exports = JellyfinClient;
