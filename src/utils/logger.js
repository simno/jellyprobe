const pino = require('pino');

const level = (process.env.LOG_LEVEL || 'info').toLowerCase();

// JSON in production, human-friendly when stdout is a TTY (dev). Tests run
// non-TTY so logs stay parseable; explicit LOG_PRETTY=0 also disables pretty.
const isTTY = process.stdout.isTTY;
const wantPretty = process.env.LOG_PRETTY !== '0' && (process.env.LOG_PRETTY === '1' || isTTY);

const baseOptions = { level };

const logger = wantPretty
  ? pino({
    ...baseOptions,
    transport: {
      target: 'pino-pretty',
      options: { colorize: true, translateTime: 'SYS:standard', ignore: 'pid,hostname' }
    }
  })
  : pino(baseOptions);

// Existing call sites use `log.info('msg', extraArg, ...)` style with
// arbitrary trailing arguments (often Error objects or strings). Adapt to
// pino's (mergingObject, message) signature so we don't have to touch every
// call site.
function adapt(method) {
  return (...args) => {
    if (args.length === 0) return logger[method]();
    if (args.length === 1) return logger[method](args[0]);
    const [first, ...rest] = args;
    if (typeof first === 'string') {
      return logger[method](first + ' ' + rest.map(stringify).join(' '));
    }
    if (first instanceof Error) {
      return logger[method]({ err: first }, rest.map(stringify).join(' '));
    }
    return logger[method](first, rest.map(stringify).join(' '));
  };
}

function stringify(v) {
  if (v instanceof Error) return v.stack || v.message;
  if (typeof v === 'string') return v;
  try { return JSON.stringify(v); } catch (_e) { return String(v); }
}

module.exports = {
  debug: adapt('debug'),
  info: adapt('info'),
  warn: adapt('warn'),
  error: adapt('error'),
  // Expose the underlying pino logger for child loggers / pino-http.
  pino: logger
};
