const {
  DEFAULT_VIDEO_CODEC,
  VIDEO_CODEC_OPTIONS,
  getVideoTranscodeParams,
  getTranscodeCodec,
  getVideoCodecLabel,
  normalizeVideoCodec
} = require('../../src/shared/video-codecs');

describe('VideoCodecRegistry', () => {
  test('exposes all supported Jellyfin codec profile options', () => {
    const codecValues = VIDEO_CODEC_OPTIONS.map(codec => codec.value);

    expect(codecValues).toEqual([
      'h264',
      'hevc',
      'mpeg2video',
      'vc1',
      'vp8',
      'vp9',
      'av1',
      'hevc-10bit',
      'vp9-10bit',
      'hevc-rext-8-10bit',
      'hevc-rext-12bit'
    ]);
  });

  test('normalizes variant labels and aliases to canonical values', () => {
    expect(normalizeVideoCodec('HEVC 10bit')).toBe('hevc-10bit');
    expect(normalizeVideoCodec('vp9_10bit')).toBe('vp9-10bit');
    expect(normalizeVideoCodec('hevc_rext_12bit')).toBe('hevc-rext-12bit');
    expect(normalizeVideoCodec('unknown-codec')).toBe(DEFAULT_VIDEO_CODEC);
  });

  test('maps codec variants to preview transcode codec families', () => {
    expect(getTranscodeCodec('hevc-10bit')).toBe('hevc');
    expect(getTranscodeCodec('vp9-10bit')).toBe('vp9');
    expect(getTranscodeCodec('hevc-rext-8-10bit')).toBe('hevc');
  });

  test('returns Jellyfin transcode parameters for codec variants', () => {
    expect(getVideoTranscodeParams('hevc')).toEqual({ videoCodec: 'hevc', maxVideoBitDepth: 8 });
    expect(getVideoTranscodeParams('vp9-10bit')).toEqual({ videoCodec: 'vp9', maxVideoBitDepth: 10 });
    expect(getVideoTranscodeParams('hevc-rext-12bit')).toEqual({
      videoCodec: 'hevc',
      profile: 'rext',
      maxVideoBitDepth: 12
    });
  });

  test('returns user-facing labels for codec variants', () => {
    expect(getVideoCodecLabel('hevc-rext-8-10bit')).toBe('HEVC RExt 8/10bit');
    expect(getVideoCodecLabel('vp8')).toBe('VP8');
  });
});
