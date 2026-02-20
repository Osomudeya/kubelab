/**
 * Centralized error handling middleware
 * Formats all errors into consistent JSON responses
 */

const logger = require('./logger');

/**
 * Error handler middleware
 * Should be used as the last middleware in Express app
 */
const errorHandler = (err, req, res, next) => {
  // Log the error
  logger.error('Error occurred:', {
    error: err.message,
    stack: err.stack,
    path: req.path,
    method: req.method
  });

  // Determine status code
  const statusCode = err.statusCode || err.status || 500;

  // Determine error message
  const message = err.message || 'Internal server error';

  // Send error response
  res.status(statusCode).json({
    success: false,
    error: message,
    ...(process.env.NODE_ENV === 'development' && { stack: err.stack })
  });
};

/**
 * 404 Not Found handler
 */
const notFoundHandler = (req, res, next) => {
  const error = new Error(`Route not found: ${req.method} ${req.path}`);
  error.statusCode = 404;
  next(error);
};

module.exports = {
  errorHandler,
  notFoundHandler
};

