const log = require('../utils/logger');

// Wraps an async route handler so thrown/rejected errors are logged centrally
// and a consistent JSON error response is returned. Per-route fallback message
// preserves the user-facing copy from the original inline handlers.
function asyncHandler(fallbackMessage, fn) {
  return async (req, res, next) => {
    try {
      await fn(req, res, next);
    } catch (err) {
      log.error(`${req.method} ${req.originalUrl}:`, err);
      if (res.headersSent) return;
      res.status(err.status || 500).json({ error: fallbackMessage });
    }
  };
}

module.exports = asyncHandler;
