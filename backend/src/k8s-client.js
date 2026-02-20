/**
 * Kubernetes API client initialization
 * Supports both in-cluster authentication (when running in Kubernetes)
 * and kubeconfig-based authentication (for local development)
 */

const k8s = require('@kubernetes/client-node');
const logger = require('./middleware/logger');

let k8sApi = null;
let coreV1Api = null;
let batchV1Api = null;
let appsV1Api = null;

/**
 * Initialize Kubernetes API client
 * Tries in-cluster config first, falls back to kubeconfig for local dev
 */
function initializeK8sClient() {
  const kc = new k8s.KubeConfig();
  const fs = require('fs');
  const path = require('path');

  // Check if we're actually in a Kubernetes cluster
  // by checking if the service account token file exists
  const inClusterTokenPath = '/var/run/secrets/kubernetes.io/serviceaccount/token';
  const inClusterCAPath = '/var/run/secrets/kubernetes.io/serviceaccount/ca.crt';
  
  const isInCluster = fs.existsSync(inClusterTokenPath) && fs.existsSync(inClusterCAPath);

  if (isInCluster) {
    try {
      // Try to load in-cluster config (when running inside Kubernetes)
      kc.loadFromCluster();
      logger.info('Loaded Kubernetes config from in-cluster service account');
    } catch (err) {
      logger.warn('Failed to load in-cluster config, falling back to kubeconfig', { error: err.message });
      // Fall through to kubeconfig
      try {
        kc.loadFromDefault();
        logger.info('Loaded Kubernetes config from default kubeconfig (fallback)');
      } catch (kubeconfigError) {
        logger.error('Failed to load Kubernetes config', {
          inClusterError: err.message,
          kubeconfigError: kubeconfigError.message
        });
        throw new Error('Unable to initialize Kubernetes client. Ensure you are running in-cluster or have kubeconfig configured.');
      }
    }
  } else {
    // Not in cluster, use kubeconfig
    try {
      // Check if KUBECONFIG env var is set
      const kubeconfigPath = process.env.KUBECONFIG || path.join(process.env.HOME || '/home/node', '.kube', 'config');
      
      if (fs.existsSync(kubeconfigPath)) {
        kc.loadFromFile(kubeconfigPath);
        logger.info('Loaded Kubernetes config from kubeconfig file');
      } else {
        // Try default locations
        kc.loadFromDefault();
        logger.info('Loaded Kubernetes config from default kubeconfig');
      }
    } catch (kubeconfigError) {
      logger.error('Failed to load Kubernetes config', {
        kubeconfigError: kubeconfigError.message,
        kubeconfigPath: process.env.KUBECONFIG || '~/.kube/config'
      });
      throw new Error('Unable to initialize Kubernetes client. Ensure kubeconfig is configured. For Docker Compose testing, mount your kubeconfig: -v ~/.kube/config:/home/node/.kube/config:ro');
    }
  }

  // Create API clients
  try {
    k8sApi = kc.makeApiClient(k8s.CoreV1Api);
    coreV1Api = kc.makeApiClient(k8s.CoreV1Api);
    batchV1Api = kc.makeApiClient(k8s.BatchV1Api);   // for Jobs (stress tests)
    appsV1Api = kc.makeApiClient(k8s.AppsV1Api);     // for StatefulSets (db-failure)
    logger.info('Kubernetes API client initialized successfully');
  } catch (apiError) {
    logger.warn('Failed to create Kubernetes API clients, API will not be available', {
      error: apiError.message
    });
    k8sApi = null;
    coreV1Api = null;
    batchV1Api = null;
    appsV1Api = null;
  }
  
  return { k8sApi, coreV1Api, batchV1Api, appsV1Api };
}

/**
 * Get the Kubernetes API client instances
 * Initializes if not already initialized
 */
function getK8sClient() {
  if (!k8sApi || !coreV1Api) {
    return initializeK8sClient();
  }
  return { k8sApi, coreV1Api, batchV1Api, appsV1Api };
}

module.exports = {
  initializeK8sClient,
  getK8sClient
};

