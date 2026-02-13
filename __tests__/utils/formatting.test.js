/**
 * Tests for media item formatting and display
 * These functions are used in the frontend app.js
 */

describe('Media Item Formatting', () => {
  // Helper function from app.js
  function formatItemName(item) {
    if (!item) return 'Unknown';
    
    // Format TV episodes as "Series Name S01E02 - Episode Name"
    if (item.Type === 'Episode' && item.SeriesName) {
      const season = item.ParentIndexNumber ? `S${item.ParentIndexNumber}` : '';
      const episode = item.IndexNumber ? `E${item.IndexNumber}` : '';
      const episodeNum = season || episode ? ` ${season}${episode}` : '';
      return `${item.SeriesName}${episodeNum} - ${item.Name}`;
    }
    
    return item.Name || 'Unknown';
  }

  describe('formatItemName', () => {
    test('should format TV episodes with series name and numbers', () => {
      const episode = {
        Type: 'Episode',
        SeriesName: 'Breaking Bad',
        ParentIndexNumber: 5,
        IndexNumber: 14,
        Name: 'Ozymandias'
      };

      expect(formatItemName(episode)).toBe('Breaking Bad S5E14 - Ozymandias');
    });

    test('should format episodes with season only', () => {
      const episode = {
        Type: 'Episode',
        SeriesName: 'Friends',
        ParentIndexNumber: 1,
        Name: 'Pilot'
      };

      expect(formatItemName(episode)).toBe('Friends S1 - Pilot');
    });

    test('should format episodes with episode only', () => {
      const episode = {
        Type: 'Episode',
        SeriesName: 'Show',
        IndexNumber: 5,
        Name: 'Episode Name'
      };

      expect(formatItemName(episode)).toBe('Show E5 - Episode Name');
    });

    test('should format episodes without numbers', () => {
      const episode = {
        Type: 'Episode',
        SeriesName: 'Special',
        Name: 'Holiday Special'
      };

      expect(formatItemName(episode)).toBe('Special - Holiday Special');
    });

    test('should not format movies', () => {
      const movie = {
        Type: 'Movie',
        Name: 'The Matrix'
      };

      expect(formatItemName(movie)).toBe('The Matrix');
    });

    test('should handle episodes without SeriesName', () => {
      const episode = {
        Type: 'Episode',
        Name: 'Some Episode'
      };

      expect(formatItemName(episode)).toBe('Some Episode');
    });

    test('should handle null item', () => {
      expect(formatItemName(null)).toBe('Unknown');
    });

    test('should handle item without name', () => {
      const item = { Type: 'Movie' };
      expect(formatItemName(item)).toBe('Unknown');
    });
  });

  describe('media search filtering', () => {
    const items = [
      { Id: '1', Type: 'Episode', SeriesName: 'Breaking Bad', ParentIndexNumber: 5, IndexNumber: 14, Name: 'Ozymandias' },
      { Id: '2', Type: 'Episode', SeriesName: 'Breaking Bad', ParentIndexNumber: 1, IndexNumber: 1, Name: 'Pilot' },
      { Id: '3', Type: 'Movie', Name: 'The Shawshank Redemption' },
      { Id: '4', Type: 'Episode', SeriesName: 'Friends', ParentIndexNumber: 1, IndexNumber: 1, Name: 'The One Where Monica Gets a Roommate' }
    ];

    function filterItems(items, query) {
      const lowerQuery = query.toLowerCase().trim();
      return items.filter(item => {
        const displayName = formatItemName(item).toLowerCase();
        return displayName.includes(lowerQuery);
      });
    }

    test('should filter by series name', () => {
      const results = filterItems(items, 'breaking bad');
      expect(results.length).toBe(2);
      expect(results[0].Id).toBe('1');
      expect(results[1].Id).toBe('2');
    });

    test('should filter by episode name', () => {
      const results = filterItems(items, 'ozymandias');
      expect(results.length).toBe(1);
      expect(results[0].Id).toBe('1');
    });

    test('should filter by season and episode', () => {
      const results = filterItems(items, 's5e14');
      expect(results.length).toBe(1);
      expect(results[0].Name).toBe('Ozymandias');
    });

    test('should filter by movie name', () => {
      const results = filterItems(items, 'shawshank');
      expect(results.length).toBe(1);
      expect(results[0].Id).toBe('3');
    });

    test('should be case insensitive', () => {
      const results = filterItems(items, 'BREAKING BAD');
      expect(results.length).toBe(2);
    });

    test('should handle partial matches', () => {
      const results = filterItems(items, 'break');
      expect(results.length).toBe(2);
    });

    test('should return empty array for no matches', () => {
      const results = filterItems(items, 'nonexistent');
      expect(results.length).toBe(0);
    });

    test('should handle empty query', () => {
      const results = filterItems(items, '');
      expect(results.length).toBe(items.length);
    });
  });

  describe('formatBytes', () => {
    function formatBytes(bytes) {
      if (bytes === 0) return '0 B';
      const k = 1024;
      const sizes = ['B', 'KB', 'MB', 'GB'];
      const i = Math.floor(Math.log(bytes) / Math.log(k));
      return Math.round(bytes / Math.pow(k, i) * 100) / 100 + ' ' + sizes[i];
    }

    test('should format 0 bytes', () => {
      expect(formatBytes(0)).toBe('0 B');
    });

    test('should format bytes', () => {
      expect(formatBytes(500)).toBe('500 B');
    });

    test('should format kilobytes', () => {
      expect(formatBytes(1024)).toBe('1 KB');
      expect(formatBytes(1536)).toBe('1.5 KB');
    });

    test('should format megabytes', () => {
      expect(formatBytes(1048576)).toBe('1 MB');
      expect(formatBytes(5242880)).toBe('5 MB');
    });

    test('should format gigabytes', () => {
      expect(formatBytes(1073741824)).toBe('1 GB');
      expect(formatBytes(2147483648)).toBe('2 GB');
    });
  });
});
