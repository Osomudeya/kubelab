/**
 * KubeLab Backend Server
 * Express server with Kubernetes API integration
 * Provides endpoints for cluster status and failure simulation
 */

require('dotenv').config();
const express = require('express');
const cors = require('cors');
const { initializeK8sClient } = require('./k8s-client');
const logger = require('./middleware/logger');
const { errorHandler, notFoundHandler } = require('./middleware/error-handler');
const { register, httpRequestCounter, httpRequestDuration } = require('./utils/metrics');
const readinessState = require('./utils/readiness-state');

// Import routes
const clusterRoutes = require('./routes/cluster');
const simulationRoutes = require('./routes/simulation');

// Initialize Express app
const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(cors());

// Ensure POST/PUT/PATCH are treated as JSON (proxies can strip Content-Type → 415)
app.use((req, res, next) => {
  const method = (req.method || '').toUpperCase();
  if (['POST', 'PUT', 'PATCH'].includes(method)) {
    req.headers['content-type'] = 'application/json';
  }
  next();
});
// Accept any Content-Type for JSON so proxy/nginx never cause 415
app.use(express.json({ type: '*/*', strict: true }));
app.use(express.urlencoded({ extended: true }));

// Request logging middleware
app.use((req, res, next) => {
  const startTime = Date.now();
  
  res.on('finish', () => {
    const duration = (Date.now() - startTime) / 1000;
    const route = req.route ? req.route.path : req.path;
    
    httpRequestCounter.inc({
      method: req.method,
      route: route,
      status_code: res.statusCode
    });
    
    httpRequestDuration.observe({
      method: req.method,
      route: route,
      status_code: res.statusCode
    }, duration);
    
    logger.info('HTTP Request', {
      method: req.method,
      path: req.path,
      statusCode: res.statusCode,
      duration: `${duration.toFixed(3)}s`
    });
  });
  
  next();
});

// Health check endpoint (jsonFix: true = express.json({ type: '*/*' }) applied)
app.get('/health', (req, res) => {
  const fs = require('fs');
  const inCluster = fs.existsSync('/var/run/secrets/kubernetes.io/serviceaccount/token');
  res.status(200).json({
    success: true,
    status: 'healthy',
    mockMode: !inCluster,
    jsonFix: true,
    timestamp: new Date().toISOString()
  });
});

// Readiness probe endpoint
// Returns 503 when the fail-readiness simulation is active — this causes
// Kubernetes to remove this pod from Service endpoints (no new traffic).
// The pod stays Running (liveness probe still passes). That's the point.
app.get('/ready', async (req, res) => {
  if (!readinessState.isHealthy()) {
    const st = readinessState.status();
    return res.status(503).json({
      success: false,
      status: 'not ready — readiness simulation active',
      secondsRemaining: st.secondsRemaining,
      timestamp: new Date().toISOString()
    });
  }

  try {
    // Check if Kubernetes client is initialized
    const { getK8sClient } = require('./k8s-client');
    getK8sClient();
    
    res.status(200).json({
      success: true,
      status: 'ready',
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    logger.error('Readiness check failed', { error: error.message });
    res.status(503).json({
      success: false,
      status: 'not ready',
      error: 'Kubernetes client not initialized',
      timestamp: new Date().toISOString()
    });
  }
});

// Metrics endpoint for Prometheus
app.get('/metrics', async (req, res) => {
  try {
    res.set('Content-Type', register.contentType);
    const metrics = await register.metrics();
    res.end(metrics);
  } catch (error) {
    logger.error('Failed to generate metrics', { error: error.message });
    res.status(500).json({
      success: false,
      error: 'Failed to generate metrics'
    });
  }
});

// API routes
app.use('/api/cluster', clusterRoutes);
app.use('/api/simulate', simulationRoutes);

// Root endpoint
app.get('/', (req, res) => {
  res.json({
    success: true,
    message: 'KubeLab Backend API',
    version: '1.0.0',
    endpoints: {
      health: '/health',
      readiness: '/ready',
      metrics: '/metrics',
      clusterStatus: '/api/cluster/status',
      simulations: {
        killPod: 'POST /api/simulate/kill-pod',
        killAllPods: 'POST /api/simulate/kill-all-pods',
        drainNode: 'POST /api/simulate/drain-node',
        cpuStress: 'POST /api/simulate/cpu-stress',
        memoryStress: 'POST /api/simulate/memory-stress',
        dbFailure: 'POST /api/simulate/db-failure',
        failReadiness: 'POST /api/simulate/fail-readiness',
        restoreReadiness: 'POST /api/simulate/restore-readiness'
      }
    }
  });
});

// 404 handler
app.use(notFoundHandler);

// Error handler (must be last)
app.use(errorHandler);

// Initialize Kubernetes client and start server
async function startServer() {
  try {
    // Initialize Kubernetes client
    logger.info('Initializing Kubernetes client...');
    initializeK8sClient();
    logger.info('Kubernetes client initialized successfully');
    
    // Start Express server
    app.listen(PORT, '0.0.0.0', () => {
      logger.info(`KubeLab Backend Server started`, {
        port: PORT,
        environment: process.env.NODE_ENV || 'development',
        timestamp: new Date().toISOString()
      });
    });
  } catch (error) {
    logger.error('Failed to start server', {
      error: error.message,
      stack: error.stack
    });
    process.exit(1);
  }
}

// Handle unhandled promise rejections
process.on('unhandledRejection', (reason, promise) => {
  logger.error('Unhandled Rejection at:', { promise, reason });
});

// Handle uncaught exceptions
process.on('uncaughtException', (error) => {
  logger.error('Uncaught Exception:', { error: error.message, stack: error.stack });
  process.exit(1);
});

// Graceful shutdown
process.on('SIGTERM', () => {
  logger.info('SIGTERM received, shutting down gracefully');
  process.exit(0);
});

process.on('SIGINT', () => {
  logger.info('SIGINT received, shutting down gracefully');
  process.exit(0);
});

// Start the server
startServer();

module.exports = app;

