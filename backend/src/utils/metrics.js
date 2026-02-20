/**
 * Prometheus metrics setup for KubeLab backend
 * Exposes metrics for monitoring request counts and durations
 */

const client = require('prom-client');

// Create a Registry to register the metrics
const register = new client.Registry();

// Add default metrics (CPU, memory, etc.)
client.collectDefaultMetrics({ register });

// HTTP request counter
const httpRequestCounter = new client.Counter({
  name: 'http_requests_total',
  help: 'Total number of HTTP requests',
  labelNames: ['method', 'route', 'status_code'],
  registers: [register]
});

// HTTP request duration histogram
const httpRequestDuration = new client.Histogram({
  name: 'http_request_duration_seconds',
  help: 'Duration of HTTP requests in seconds',
  labelNames: ['method', 'route', 'status_code'],
  buckets: [0.1, 0.5, 1, 2, 5, 10],
  registers: [register]
});

// Kubernetes operation counter
const k8sOperationCounter = new client.Counter({
  name: 'kubernetes_operations_total',
  help: 'Total number of Kubernetes API operations',
  labelNames: ['operation', 'resource', 'status'],
  registers: [register]
});

// Kubernetes operation duration
const k8sOperationDuration = new client.Histogram({
  name: 'kubernetes_operation_duration_seconds',
  help: 'Duration of Kubernetes API operations in seconds',
  labelNames: ['operation', 'resource'],
  buckets: [0.1, 0.5, 1, 2, 5, 10],
  registers: [register]
});

// Simulation events counter
const simulationEventsCounter = new client.Counter({
  name: 'simulation_events_total',
  help: 'Total number of simulation events triggered',
  labelNames: ['type'],
  registers: [register]
});

// Pods running gauge
const podsRunningGauge = new client.Gauge({
  name: 'pods_running',
  help: 'Number of pods currently running',
  labelNames: ['namespace', 'status'],
  registers: [register]
});

// Nodes ready gauge
const nodesReadyGauge = new client.Gauge({
  name: 'nodes_ready',
  help: 'Number of nodes in ready state',
  registers: [register]
});

module.exports = {
  register,
  httpRequestCounter,
  httpRequestDuration,
  k8sOperationCounter,
  k8sOperationDuration,
  simulationEventsCounter,
  podsRunningGauge,
  nodesReadyGauge
};

