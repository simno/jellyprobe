const express = require('express');
const axios = require('axios');
const asyncHandler = require('../middleware/asyncHandler');
const validate = require('../middleware/validate');
const { itemIdParam, streamQuery } = require('../schemas');
const { normalizeVideoCodec } = require('../shared/video-codecs');

function createStreamRouter({ jellyfinClient }) {
  const router = express.Router();

  // HLS entry point: fetches master.m3u8 and rewrites URLs through /jf/.
  router.get('/:itemId',
    validate({ params: itemIdParam, query: streamQuery }),
    asyncHandler('Stream proxy failed', async (req, res) => {
      const { itemId } = req.params;
      const { mediaSourceId, deviceId, playSessionId, videoCodec, audioCodec, maxBitrate, maxWidth, maxHeight } = req.query;

      const masterUrl = jellyfinClient.getStreamUrl(itemId, mediaSourceId, deviceId, {
        playSessionId: playSessionId || '',
        videoCodec: normalizeVideoCodec(videoCodec),
        audioCodec: audioCodec || 'aac',
        maxBitrate,
        maxWidth,
        maxHeight
      });

      // Force text response so the regex rewrite below cannot silently no-op
      // on a buffer when axios infers a non-text content type.
      const upstream = await axios.get(masterUrl, {
        timeout: 30000,
        responseType: 'text',
        headers: { 'X-Emby-Token': jellyfinClient.apiKey }
      });

      const masterDir = new URL(masterUrl).pathname.replace(/[^/]*$/, '');
      let body = upstream.data;
      if (typeof body === 'string') {
        body = body.replace(/(^[^#\s].*$)/gm, (line) => {
          if (line.startsWith('http')) return line;
          if (line.startsWith('/')) return `/jf${line}`;
          return `/jf${masterDir}${line}`;
        });
      }

      res.setHeader('Content-Type', upstream.headers['content-type'] || 'application/vnd.apple.mpegurl');
      res.send(body);
    })
  );

  return router;
}

module.exports = { createStreamRouter };
