const LEVELS = { debug: 10, info: 20, warn: 30, error: 40 };
const configured = (process.env.LOG_LEVEL || 'info').toLowerCase();
const threshold = LEVELS[configured] ?? LEVELS.info;

function emit(level, stream, args) {
  if (LEVELS[level] < threshold) return;
  stream(`[${new Date().toISOString()}] [${level.toUpperCase()}]`, ...args);
}

module.exports = {
  debug: (...args) => emit('debug', console.log, args),
  info:  (...args) => emit('info',  console.log, args),
  warn:  (...args) => emit('warn',  console.warn, args),
  error: (...args) => emit('error', console.error, args)
};
