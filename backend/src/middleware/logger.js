/**
 * Simple logger utility
 * In production, consider using a proper logging library like winston or pino
 */

const log = (level, message, meta = {}) => {
  const timestamp = new Date().toISOString();
  const logEntry = {
    timestamp,
    level,
    message,
    ...meta
  };
  console.log(JSON.stringify(logEntry));
};

const logger = {
  info: (message, meta) => log('INFO', message, meta),
  error: (message, meta) => log('ERROR', message, meta),
  warn: (message, meta) => log('WARN', message, meta),
  debug: (message, meta) => log('DEBUG', message, meta)
};

module.exports = logger;

