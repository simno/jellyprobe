const path = require('path');
const axios = require('axios');
const log = require('../utils/logger');

// Jellyfin passthrough proxy — must be mounted before body parser to avoid
// consuming binary video bodies. Only paths under /Videos/ or /Audio/ are
// allowed, to prevent SSRF to other Jellyfin endpoints.
const ALLOWED_PROXY_PREFIXES = ['/Videos/', '/Audio/'];

// Two-stage check: reject any traversal hint *before* normalize collapses it,
// then verify the normalized path falls under an allowed prefix. The raw
// `..` rejection prevents tricks like `/Videos/../Users/...` from sneaking
// through normalize → prefix-match.
function isAllowedProxyPath(decodedPath) {
  if (decodedPath.includes('..')) return false;
  const normalized = path.posix.normalize(decodedPath);
  if (normalized.includes('..')) return false;
  return ALLOWED_PROXY_PREFIXES.some((p) => normalized.startsWith(p));
}

function createProxyHandler({ jellyfinClient }) {
  return async function proxyHandler(req, res) {
    let upstream;
    try {
      const parsedPath = new URL(req.url, 'http://localhost').pathname;
      let decodedPath;
      try {
        decodedPath = decodeURIComponent(parsedPath);
      } catch (_e) {
        return res.status(400).json({ error: 'Malformed proxy path' });
      }
      if (!isAllowedProxyPath(decodedPath)) {
        return res.status(403).json({ error: 'Forbidden proxy path' });
      }

      const targetUrl = `${jellyfinClient.baseUrl}${req.url}`;
      upstream = await axios.get(targetUrl, {
        responseType: 'stream',
        timeout: 30000,
        validateStatus: () => true,
        headers: {
          'X-Emby-Token': jellyfinClient.apiKey,
          ...(req.headers.range ? { Range: req.headers.range } : {})
        }
      });

      const ct = upstream.headers['content-type'] || 'application/octet-stream';
      res.status(upstream.status || 200);
      res.setHeader('Content-Type', ct);
      if (upstream.headers['content-range']) res.setHeader('Content-Range', upstream.headers['content-range']);
      if (upstream.headers['accept-ranges']) res.setHeader('Accept-Ranges', upstream.headers['accept-ranges']);

      const isPlaylist = ct.includes('mpegurl') || ct.includes('x-mpegURL');

      if (isPlaylist) {
        const chunks = [];
        for await (const chunk of upstream.data) chunks.push(chunk);
        // Rewrite absolute upstream paths through /jf, but only those that
        // would themselves be proxy-allowed. Anything outside /Videos/ or
        // /Audio/ is left unchanged so a malicious upstream playlist cannot
        // coerce the client into requesting /jf/Users/... etc.
        const body = Buffer.concat(chunks).toString('utf-8').replace(/^(\/[^#\s].*)$/gm, (line) => {
          return isAllowedProxyPath(line) ? `/jf${line}` : line;
        });
        return res.send(body);
      }

      if (upstream.headers['content-length']) res.setHeader('Content-Length', upstream.headers['content-length']);
      upstream.data.on('error', (err) => {
        log.error('Proxy upstream stream error:', err.message);
        if (!res.headersSent) res.status(502).json({ error: 'Proxy stream failed' });
        else res.destroy(err);
      });
      req.on('close', () => upstream.data.destroy());
      upstream.data.pipe(res);
    } catch (error) {
      log.error('Proxy request failed:', error.message);
      if (upstream?.data?.destroy) upstream.data.destroy();
      if (!res.headersSent) {
        res.status(error.response?.status || 502).json({ error: 'Proxy request failed' });
      }
    }
  };
}

module.exports = { createProxyHandler };
