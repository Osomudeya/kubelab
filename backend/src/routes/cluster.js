/**
 * Cluster status and information endpoints
 * Provides read-only access to cluster state (pods, nodes)
 */

const express = require('express');
const router = express.Router();
const { getK8sClient } = require('../k8s-client');
const logger = require('../middleware/logger');
const { k8sOperationCounter, k8sOperationDuration, podsRunningGauge, nodesReadyGauge } = require('../utils/metrics');

const DEFAULT_NAMESPACE = 'kubelab';

// Simple in-memory cache for cluster status (2 second TTL)
let clusterStatusCache = null;
let cacheTimestamp = 0;
const CACHE_TTL = 2000; // 2 seconds

/**
 * GET /api/cluster/status
 * Returns current cluster status including pods and nodes
 * Cached for 2 seconds to reduce Kubernetes API calls
 */
router.get('/status', async (req, res, next) => {
  const startTime = Date.now();
  
  // Return cached response if still valid
  const now = Date.now();
  if (clusterStatusCache && (now - cacheTimestamp) < CACHE_TTL) {
    return res.json(clusterStatusCache);
  }
  
  try {
    const clients = getK8sClient();
    const { k8sApi, coreV1Api } = clients;
    
    // Check if Kubernetes API is available
    if (!k8sApi || !coreV1Api) {
      // Kubernetes API not available (e.g., Docker Compose testing without kubeconfig)
      logger.info('Kubernetes API not available, returning mock data for Docker Compose testing');
      const mockResponse = {
        success: true,
        data: {
          namespace: 'kubelab',
          pods: [],
          nodes: [],
          summary: {
            totalPods: 0,
            totalNodes: 0,
            podsByStatus: {},
            nodesByRole: {}
          },
          timestamp: new Date().toISOString(),
          note: 'Kubernetes API not available. This is normal when running in Docker Compose. Deploy to Kubernetes to see real cluster data.'
        }
      };
      clusterStatusCache = mockResponse;
      cacheTimestamp = Date.now();
      return res.json(mockResponse);
    }
    const namespace = req.query.namespace || DEFAULT_NAMESPACE;

    logger.info('Fetching cluster status', { namespace });

    // Fetch pods in the namespace
    let podsResponse, nodesResponse;
    try {
      const podsPromise = k8sApi.listNamespacedPod(
        namespace,
        undefined, // pretty
        undefined, // allowWatchBookmarks
        undefined, // continue
        undefined, // fieldSelector
        undefined  // labelSelector
      );

      // Fetch all nodes
      const nodesPromise = coreV1Api.listNode();

      // Execute both requests in parallel
      [podsResponse, nodesResponse] = await Promise.all([
        podsPromise,
        nodesPromise
      ]);
    } catch (apiError) {
      // Kubernetes API call failed (e.g., exec auth issues in Docker Compose)
      logger.warn('Kubernetes API call failed, returning mock data', { error: apiError.message });
      const mockResponse = {
        success: true,
        data: {
          namespace: 'kubelab',
          pods: [],
          nodes: [],
          summary: {
            totalPods: 0,
            totalNodes: 0,
            podsByStatus: {},
            nodesByRole: {}
          },
          timestamp: new Date().toISOString(),
          note: 'Kubernetes API not available. This is normal when running in Docker Compose. Deploy to Kubernetes to see real cluster data.'
        }
      };
      clusterStatusCache = mockResponse;
      cacheTimestamp = Date.now();
      return res.json(mockResponse);
    }

    // Format pod information — include container state (OOMKilled, CrashLoopBackOff) and restart count
    const pods = podsResponse.body.items.map(pod => {
      const containerStatus = pod.status.containerStatuses?.[0];
      const waitingReason = containerStatus?.state?.waiting?.reason;
      const terminatedReason = containerStatus?.lastState?.terminated?.reason;
      const actualStatus = (waitingReason || terminatedReason || pod.status.phase || '').toLowerCase();
      const restartCount = containerStatus?.restartCount ?? 0;
      return {
        name: pod.metadata.name,
        namespace: pod.metadata.namespace,
        status: pod.status.phase,
        actualStatus: actualStatus || pod.status.phase?.toLowerCase(),
        restartCount,
        nodeName: pod.spec.nodeName,
        createdAt: pod.metadata.creationTimestamp,
        labels: pod.metadata.labels,
        containers: pod.spec.containers.map(c => ({
          name: c.name,
          image: c.image,
          ready: pod.status.containerStatuses?.find(cs => cs.name === c.name)?.ready || false
        }))
      };
    });

    // Format node information
    const nodes = nodesResponse.body.items.map(node => ({
      name: node.metadata.name,
      // Standard kubeadm label OR MicroK8s-specific label
      role: (
        node.metadata.labels['node-role.kubernetes.io/control-plane'] ||
        node.metadata.labels['node.kubernetes.io/microk8s-controlplane']
      ) ? 'control-plane' : 'worker',
      status: node.status.conditions?.find(c => c.type === 'Ready')?.status || 'Unknown',
      unschedulable: node.spec.unschedulable || false,
      createdAt: node.metadata.creationTimestamp,
      addresses: node.status.addresses?.map(a => ({
        type: a.type,
        address: a.address
      })) || [],
      capacity: node.status.capacity,
      allocatable: node.status.allocatable
    }));

    const duration = (Date.now() - startTime) / 1000;
    k8sOperationDuration.observe({ operation: 'list', resource: 'pods' }, duration);
    k8sOperationCounter.inc({ operation: 'list', resource: 'pods', status: 'success' });
    k8sOperationCounter.inc({ operation: 'list', resource: 'nodes', status: 'success' });

    // Update gauge metrics
    const podsByStatus = pods.reduce((acc, pod) => {
      acc[pod.status] = (acc[pod.status] || 0) + 1;
      return acc;
    }, {});
    
    // Set pod metrics by status
    Object.keys(podsByStatus).forEach(status => {
      podsRunningGauge.set({ namespace, status }, podsByStatus[status]);
    });
    
    // Set nodes ready count
    const readyNodesCount = nodes.filter(n => n.status === 'True').length;
    nodesReadyGauge.set(readyNodesCount);

    logger.info('Cluster status fetched successfully', {
      namespace,
      podCount: pods.length,
      nodeCount: nodes.length
    });

    const response = {
      success: true,
      data: {
        namespace,
        pods,
        nodes,
        summary: {
          totalPods: pods.length,
          totalNodes: nodes.length,
          podsByStatus: pods.reduce((acc, pod) => {
            acc[pod.status] = (acc[pod.status] || 0) + 1;
            return acc;
          }, {}),
          nodesByRole: nodes.reduce((acc, node) => {
            acc[node.role] = (acc[node.role] || 0) + 1;
            return acc;
          }, {})
        },
        timestamp: new Date().toISOString()
      }
    };
    
    // Cache the response
    clusterStatusCache = response;
    cacheTimestamp = Date.now();
    
    res.json(response);
  } catch (error) {
    const duration = (Date.now() - startTime) / 1000;
    k8sOperationDuration.observe({ operation: 'list', resource: 'pods' }, duration);
    k8sOperationCounter.inc({ operation: 'list', resource: 'pods', status: 'error' });
    
    logger.error('Failed to fetch cluster status', { error: error.message, stack: error.stack });
    
    // Provide user-friendly error messages
    let userMessage = 'Failed to fetch cluster status';
    if (error.statusCode === 403) {
      userMessage = 'Permission denied. Check RBAC permissions for the backend ServiceAccount.';
    } else if (error.statusCode === 401) {
      userMessage = 'Authentication failed. Check Kubernetes API credentials.';
    } else if (error.message?.includes('ECONNREFUSED')) {
      userMessage = 'Cannot connect to Kubernetes API. Ensure the cluster is running and accessible.';
    } else if (error.message) {
      userMessage = `Failed to fetch cluster status: ${error.message}`;
    }
    
    const friendlyError = new Error(userMessage);
    friendlyError.statusCode = error.statusCode || 500;
    next(friendlyError);
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// GET /api/cluster/events
// Returns recent Kubernetes events for the kubelab namespace.
// This is the equivalent of: kubectl get events -n kubelab --sort-by=lastTimestamp
// Events tell you what the cluster control-plane is actually doing:
//   - ReplicaSet created a pod (kill-pod recovery)
//   - Scheduler assigned a pod to a node
//   - Kubelet started a container
//   - OOMKilled a container (memory stress)
//   - Evicted a pod (node drain)
// ─────────────────────────────────────────────────────────────────────────────
router.get('/events', async (req, res, next) => {
  try {
    const { coreV1Api } = getK8sClient();
    const limit = Math.min(Number(req.query.limit) || 40, 100);

    const eventsResponse = await coreV1Api.listNamespacedEvent(
      DEFAULT_NAMESPACE,
      undefined, undefined, undefined, undefined, undefined,
      limit
    );

    const events = eventsResponse.body.items
      .map(e => ({
        type: e.type,                           // 'Normal' | 'Warning'
        reason: e.reason,                       // 'Killing', 'Scheduled', 'OOMKilling', etc.
        message: e.message,
        object: e.involvedObject?.name,
        kind: e.involvedObject?.kind,           // Pod | Node | Job | ReplicaSet
        timestamp: e.lastTimestamp || e.eventTime || e.firstTimestamp,
        count: e.count || 1,
      }))
      // Sort newest first so the feed shows latest at the top
      .sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));

    k8sOperationCounter.inc({ operation: 'list', resource: 'events', status: 'success' });

    res.json({ success: true, data: { events, namespace: DEFAULT_NAMESPACE } });
  } catch (error) {
    k8sOperationCounter.inc({ operation: 'list', resource: 'events', status: 'error' });
    logger.error('Failed to fetch cluster events', { error: error.message });
    next(error);
  }
});

module.exports = router;

