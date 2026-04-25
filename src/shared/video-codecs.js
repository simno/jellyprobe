/* global window */
(function (root, factory) {
  const api = factory();

  if (typeof module === 'object' && module.exports) {
    module.exports = api;
  }

  if (root) {
    root.VideoCodecRegistry = api;
  }
})(typeof window !== 'undefined' ? window : this, function () {
  const VIDEO_CODEC_OPTIONS = Object.freeze([
    {
      value: 'h264',
      label: 'H264',
      transcodeCodec: 'h264',
      transcodeParams: { videoCodec: 'h264' },
      aliases: ['h.264']
    },
    {
      value: 'hevc',
      label: 'HEVC',
      transcodeCodec: 'hevc',
      transcodeParams: { videoCodec: 'hevc', maxVideoBitDepth: 8 },
      aliases: ['h265', 'h.265']
    },
    {
      value: 'mpeg2video',
      label: 'MPEG2',
      transcodeCodec: 'mpeg2video',
      transcodeParams: { videoCodec: 'mpeg2video' },
      aliases: ['mpeg2']
    },
    {
      value: 'vc1',
      label: 'VC1',
      transcodeCodec: 'vc1',
      transcodeParams: { videoCodec: 'vc1' }
    },
    {
      value: 'vp8',
      label: 'VP8',
      transcodeCodec: 'vp8',
      transcodeParams: { videoCodec: 'vp8' }
    },
    {
      value: 'vp9',
      label: 'VP9',
      transcodeCodec: 'vp9',
      transcodeParams: { videoCodec: 'vp9', maxVideoBitDepth: 8 }
    },
    {
      value: 'av1',
      label: 'AV1',
      transcodeCodec: 'av1',
      transcodeParams: { videoCodec: 'av1' }
    },
    {
      value: 'hevc-10bit',
      label: 'HEVC 10bit',
      transcodeCodec: 'hevc',
      transcodeParams: { videoCodec: 'hevc', profile: 'main10', maxVideoBitDepth: 10 },
      aliases: ['hevc10bit', 'hevc_10bit', 'h26510bit']
    },
    {
      value: 'vp9-10bit',
      label: 'VP9 10bit',
      transcodeCodec: 'vp9',
      transcodeParams: { videoCodec: 'vp9', maxVideoBitDepth: 10 },
      aliases: ['vp910bit', 'vp9_10bit']
    },
    {
      value: 'hevc-rext-8-10bit',
      label: 'HEVC RExt 8/10bit',
      transcodeCodec: 'hevc',
      transcodeParams: { videoCodec: 'hevc', profile: 'rext', maxVideoBitDepth: 10 },
      aliases: ['hevcrext810bit', 'hevc_rext_8_10bit', 'hevc_rext']
    },
    {
      value: 'hevc-rext-12bit',
      label: 'HEVC RExt 12bit',
      transcodeCodec: 'hevc',
      transcodeParams: { videoCodec: 'hevc', profile: 'rext', maxVideoBitDepth: 12 },
      aliases: ['hevcrext12bit', 'hevc_rext_12bit']
    }
  ].map(option => Object.freeze({
    ...option,
    transcodeParams: Object.freeze({ ...(option.transcodeParams || { videoCodec: option.transcodeCodec }) }),
    aliases: Object.freeze(option.aliases || [])
  })));

  const DEFAULT_VIDEO_CODEC = 'h264';

  function normalizeKey(value) {
    return String(value || '')
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '');
  }

  const codecLookup = new Map();

  VIDEO_CODEC_OPTIONS.forEach(option => {
    [option.value, option.label, ...option.aliases].forEach(alias => {
      codecLookup.set(normalizeKey(alias), option);
    });
  });

  const defaultOption = codecLookup.get(DEFAULT_VIDEO_CODEC);

  function resolveVideoCodecOption(value) {
    return codecLookup.get(normalizeKey(value));
  }

  function getVideoCodecOption(value) {
    return resolveVideoCodecOption(value) || defaultOption;
  }

  return Object.freeze({
    VIDEO_CODEC_OPTIONS,
    DEFAULT_VIDEO_CODEC,
    normalizeVideoCodec(value) {
      return getVideoCodecOption(value).value;
    },
    getVideoCodecLabel(value) {
      const option = resolveVideoCodecOption(value);
      return option ? option.label : String(value || defaultOption.label);
    },
    getTranscodeCodec(value) {
      return getVideoCodecOption(value).transcodeCodec;
    },
    getVideoTranscodeParams(value) {
      return { ...getVideoCodecOption(value).transcodeParams };
    },
    isKnownVideoCodec(value) {
      return codecLookup.has(normalizeKey(value));
    }
  });
});
