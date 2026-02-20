/**
 * Failure simulation endpoints
 * Every endpoint here performs a REAL Kubernetes operation via the API.
 * Nothing is mocked or faked — the cluster state actually changes.
 */

const express = require('express');
const router = express.Router();
const { getK8sClient } = require('../k8s-client');
const logger = require('../middleware/logger');
const { k8sOperationCounter, k8sOperationDuration, simulationEventsCounter } = require('../utils/metrics');

const DEFAULT_NAMESPACE = 'kubelab';
const BACKEND_LABEL_SELECTOR = 'app=backend';

// ─────────────────────────────────────────────────────────────────────────────
// POST /api/simulate/kill-pod
// Deletes a random backend pod.
// Kubernetes' Deployment controller notices the missing pod and immediately
// creates a replacement — this is self-healing in action.
// ─────────────────────────────────────────────────────────────────────────────
router.post('/kill-pod', async (req, res, next) => {
  const startTime = Date.now();

  try {
    const { k8sApi } = getK8sClient();
    const namespace = req.body.namespace || DEFAULT_NAMESPACE;
    const podName = req.body.podName;

    logger.info('Attempting to kill pod', { namespace, podName: podName || 'random' });

    let targetPod;

    if (podName) {
      const response = await k8sApi.readNamespacedPod(podName, namespace);
      targetPod = response.body;
    } else {
      const podsResponse = await k8sApi.listNamespacedPod(
        namespace, undefined, undefined, undefined, undefined, BACKEND_LABEL_SELECTOR
      );
      const pods = podsResponse.body.items;

      if (pods.length === 0) {
        return res.status(404).json({
          success: false,
          error: 'No backend pods found to delete'
        });
      }

      targetPod = pods[Math.floor(Math.random() * pods.length)];
    }

    const podToDelete = targetPod.metadata.name;

    await k8sApi.deleteNamespacedPod(podToDelete, namespace);

    const duration = (Date.now() - startTime) / 1000;
    k8sOperationDuration.observe({ operation: 'delete', resource: 'pod' }, duration);
    k8sOperationCounter.inc({ operation: 'delete', resource: 'pod', status: 'success' });
    simulationEventsCounter.inc({ type: 'pod_kill' });

    logger.info('Pod deleted successfully', { namespace, podName: podToDelete });

    res.json({
      success: true,
      data: {
        message: `Pod ${podToDelete} deleted. Kubernetes will recreate it automatically.`,
        podName: podToDelete,
        namespace,
        whatToWatch: 'Run: kubectl get pods -n kubelab -w'
      }
    });
  } catch (error) {
    const duration = (Date.now() - startTime) / 1000;
    k8sOperationDuration.observe({ operation: 'delete', resource: 'pod' }, duration);
    k8sOperationCounter.inc({ operation: 'delete', resource: 'pod', status: 'error' });

    logger.error('Failed to delete pod', { error: error.message });

    if (error.statusCode === 404) {
      return res.status(404).json({ success: false, error: 'Pod not found — it may have already been deleted.' });
    }
    if (error.statusCode === 403) {
      return res.status(403).json({ success: false, error: 'Permission denied. Check RBAC for the backend ServiceAccount.' });
    }
    next(error);
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// POST /api/simulate/drain-node
// Cordons a worker node (marks it unschedulable) then evicts all pods on it.
// Pods reschedule to the remaining nodes.
// Use POST /api/simulate/uncordon-node to reverse this.
// ─────────────────────────────────────────────────────────────────────────────
router.post('/drain-node', async (req, res, next) => {
  const startTime = Date.now();

  try {
    const { k8sApi, coreV1Api } = getK8sClient();
    const { nodeName } = req.body;

    if (!nodeName) {
      return res.status(400).json({ success: false, error: 'nodeName is required' });
    }

    logger.info('Draining node', { nodeName });

    // Verify the node exists and is not a control-plane
    const nodeResponse = await coreV1Api.readNode(nodeName);
    const node = nodeResponse.body;

    // Reject both standard kubeadm label and MicroK8s-specific control-plane label
    const isControlPlane =
      node.metadata.labels['node-role.kubernetes.io/control-plane'] ||
      node.metadata.labels['node.kubernetes.io/microk8s-controlplane'];

    if (isControlPlane) {
      return res.status(400).json({ success: false, error: 'Cannot drain the control-plane node.' });
    }

    // Step 1: Cordon — mark the node unschedulable
    // patchNode params: name, body, pretty, dryRun, fieldManager, fieldValidation, force, options
    await coreV1Api.patchNode(
      nodeName,
      { spec: { unschedulable: true } },
      undefined, undefined, undefined, undefined, undefined,
      { headers: { 'Content-Type': 'application/merge-patch+json' } }
    );

    logger.info('Node cordoned', { nodeName });

    // Step 2: Evict all non-DaemonSet pods from this node
    const allPodsResponse = await k8sApi.listPodForAllNamespaces();
    const podsOnNode = allPodsResponse.body.items.filter(p => p.spec.nodeName === nodeName);

    const results = [];
    for (const pod of podsOnNode) {
      // Skip DaemonSet pods — they must run on every node
      if (pod.metadata.ownerReferences?.some(ref => ref.kind === 'DaemonSet')) {
        results.push({ podName: pod.metadata.name, skipped: true, reason: 'DaemonSet pod' });
        continue;
      }

      try {
        await k8sApi.deleteNamespacedPod(pod.metadata.name, pod.metadata.namespace, undefined, 30);
        results.push({ podName: pod.metadata.name, namespace: pod.metadata.namespace, evicted: true });
        logger.info('Pod evicted', { podName: pod.metadata.name, nodeName });
      } catch (e) {
        results.push({ podName: pod.metadata.name, evicted: false, error: e.message });
      }
    }

    const duration = (Date.now() - startTime) / 1000;
    k8sOperationDuration.observe({ operation: 'drain', resource: 'node' }, duration);
    k8sOperationCounter.inc({ operation: 'drain', resource: 'node', status: 'success' });
    simulationEventsCounter.inc({ type: 'node_drain' });

    res.json({
      success: true,
      data: {
        message: `Node ${nodeName} cordoned and drained. Pods are rescheduling to other nodes.`,
        nodeName,
        cordoned: true,
        evictionResults: results,
        summary: {
          total: podsOnNode.length,
          evicted: results.filter(r => r.evicted).length,
          skipped: results.filter(r => r.skipped).length,
          failed: results.filter(r => !r.evicted && !r.skipped).length
        },
        whatToWatch: `kubectl get nodes && kubectl get pods -n kubelab -o wide`,
        howToRestore: `POST /api/simulate/uncordon-node with { "nodeName": "${nodeName}" }`
      }
    });
  } catch (error) {
    const duration = (Date.now() - startTime) / 1000;
    k8sOperationDuration.observe({ operation: 'drain', resource: 'node' }, duration);
    k8sOperationCounter.inc({ operation: 'drain', resource: 'node', status: 'error' });
    logger.error('Failed to drain node', { error: error.message, nodeName: req.body.nodeName });

    if (error.statusCode === 404) {
      return res.status(404).json({ success: false, error: 'Node not found. Check the node name with: kubectl get nodes' });
    }
    if (error.statusCode === 403) {
      return res.status(403).json({ success: false, error: 'Permission denied. The backend ClusterRole needs node patch permission.' });
    }
    next(error);
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// POST /api/simulate/uncordon-node
// Reverses a drain — marks the node schedulable again so new pods can land on it.
// ─────────────────────────────────────────────────────────────────────────────
router.post('/uncordon-node', async (req, res, next) => {
  try {
    const { coreV1Api } = getK8sClient();
    const { nodeName } = req.body;

    if (!nodeName) {
      return res.status(400).json({ success: false, error: 'nodeName is required' });
    }

    logger.info('Uncordoning node', { nodeName });

    // patchNode params: name, body, pretty, dryRun, fieldManager, fieldValidation, force, options
    await coreV1Api.patchNode(
      nodeName,
      { spec: { unschedulable: false } },
      undefined, undefined, undefined, undefined, undefined,
      { headers: { 'Content-Type': 'application/merge-patch+json' } }
    );

    simulationEventsCounter.inc({ type: 'node_uncordon' });
    logger.info('Node uncordoned', { nodeName });

    res.json({
      success: true,
      data: {
        message: `Node ${nodeName} is now schedulable again.`,
        nodeName,
        whatToWatch: 'kubectl get nodes'
      }
    });
  } catch (error) {
    logger.error('Failed to uncordon node', { error: error.message });
    if (error.statusCode === 404) {
      return res.status(404).json({ success: false, error: 'Node not found.' });
    }
    next(error);
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// POST /api/simulate/cpu-stress
// Burns CPU *inside this backend pod* for 60 seconds using a tight JS loop.
//
// Because this pod's CPU limit is 200m, the Linux CFS scheduler will throttle
// it hard — the process tries to run flat-out but is paused ~80% of the time.
//
// What you will see:
//   kubectl top pods -n kubelab        → backend pod pinned at ~200m (the limit)
//   kubectl logs -n kubelab -l app=backend → "CPU stress running… complete"
//   Grafana CPU panel                  → sustained plateau at the limit
//
// The pod stays ALIVE — this shows throttling, not crashing.
// The OTHER backend replica continues serving requests normally.
// ─────────────────────────────────────────────────────────────────────────────
router.post('/cpu-stress', (req, res) => {
  const durationMs = (req.body.durationSeconds || 60) * 1000;
  const podName = process.env.HOSTNAME || 'unknown';

  logger.info('CPU stress starting inside this pod', { podName, durationMs });
  simulationEventsCounter.inc({ type: 'cpu_stress' });
  k8sOperationCounter.inc({ operation: 'cpu_stress', resource: 'pod', status: 'success' });

  // Respond immediately — the stress runs after the response is sent.
  // If we didn't do this, the HTTP connection would hang until the stress ends.
  res.json({
    success: true,
    data: {
      message: `CPU stress started in pod "${podName}". Running for ${durationMs / 1000}s.`,
      podName,
      durationSeconds: durationMs / 1000,
      whatToWatch: [
        'kubectl top pods -n kubelab',
        'kubectl logs -n kubelab -l app=backend -f',
        '# Watch: CPU column for the backend pods — one will peg at ~200m (the limit)'
      ]
    }
  });

  // Burn CPU in 200 ms chunks, yielding between each so health-check requests
  // can still get through (the pod stays alive — we want to show throttling).
  const endTime = Date.now() + durationMs;
  let elapsed = 0;

  const burnChunk = () => {
    if (Date.now() >= endTime) {
      logger.info('CPU stress complete', { podName, elapsed: `${Math.round(elapsed / 1000)}s` });
      return;
    }
    // Tight loop for 200 ms
    const chunkEnd = Date.now() + 200;
    while (Date.now() < chunkEnd) {
      // Intentionally un-optimisable: Math.random() prevents dead-code elimination
      Math.sqrt(Math.random() * Math.random());
    }
    elapsed += 200;
    if (elapsed % 10000 === 0) {
      logger.info('CPU stress running…', { podName, elapsed: `${elapsed / 1000}s` });
    }
    // Yield to the event loop before next chunk (lets health probes through)
    setImmediate(burnChunk);
  };

  setImmediate(burnChunk);
});

// ─────────────────────────────────────────────────────────────────────────────
// POST /api/simulate/memory-stress
// Allocates memory *inside this backend pod* in 50 MB chunks until the kernel
// kills the process for exceeding the 256 Mi container memory limit.
//
// Buffer.alloc() uses native (off-heap) memory, so it IS subject to the
// container cgroup limit — unlike regular JS objects on the V8 heap.
//
// What you will see:
//   kubectl get pods -n kubelab -w          → backend pod STATUS → OOMKilled
//   kubectl describe pod -n kubelab <name>  → Last State: OOMKilled, Exit Code: 137
//   kubectl get pods -n kubelab             → RESTARTS count increments
//
// The OTHER backend replica keeps serving requests during the OOMKill.
// Exit code 137 = 128 + SIGKILL (signal 9) — the kernel sent no warning.
// ─────────────────────────────────────────────────────────────────────────────
router.post('/memory-stress', (req, res) => {
  const podName = process.env.HOSTNAME || 'unknown';
  const chunkMB  = 50;                        // allocate 50 MB per step
  const maxChunks = 8;                        // 8 × 50 MB = 400 MB > 256 Mi limit
  const delayMs  = 800;                       // pause between chunks so logs stay readable

  logger.info('Memory stress starting inside this pod — will OOMKill', { podName, targetMB: chunkMB * maxChunks });
  simulationEventsCounter.inc({ type: 'memory_stress' });
  k8sOperationCounter.inc({ operation: 'memory_stress', resource: 'pod', status: 'success' });

  // Respond immediately — the allocation starts after the response is flushed.
  // Without this, the frontend would never receive the response because the pod
  // gets OOMKilled before the HTTP write completes.
  res.json({
    success: true,
    data: {
      message: `Memory stress started in pod "${podName}". Allocating up to ${chunkMB * maxChunks} MB — limit is 256 Mi. This pod will OOMKill.`,
      podName,
      whatToWatch: [
        'kubectl get pods -n kubelab -w',
        `kubectl describe pod -n kubelab ${podName}`,
        '# Look for: Last State: OOMKilled, Exit Code: 137'
      ]
    }
  });

  // Allocate memory chunks after response is sent.
  // We hold all buffers in the array so V8 cannot GC them.
  const held = [];
  let chunk = 0;

  const allocateNext = () => {
    if (chunk >= maxChunks) return; // unreachable if OOMKill happens first
    chunk++;
    const buf = Buffer.alloc(chunkMB * 1024 * 1024);
    // Fill with non-zero data — prevents the allocator from deferring the pages
    buf.fill(chunk);
    held.push(buf);
    logger.info(`Memory chunk allocated`, { chunk, totalMB: chunk * chunkMB, podName });
    setTimeout(allocateNext, delayMs);
  };

  // Small initial delay gives the HTTP response time to flush to the client
  setTimeout(allocateNext, 300);
});

// ─────────────────────────────────────────────────────────────────────────────
// POST /api/simulate/db-failure
// Scales the postgres StatefulSet to 0 replicas — the database disappears.
// The backend will start returning "database connection" errors.
// You will see:
//   - The postgres pod terminate in `kubectl get pods -n kubelab`
//   - Backend API errors for any DB-dependent requests
// Use POST /api/simulate/restore-db to bring the database back.
// ─────────────────────────────────────────────────────────────────────────────
router.post('/db-failure', async (req, res, next) => {
  const startTime = Date.now();

  try {
    const { appsV1Api } = getK8sClient();

    logger.info('Simulating DB failure — scaling postgres to 0');

    await appsV1Api.patchNamespacedStatefulSet(
      'postgres',
      DEFAULT_NAMESPACE,
      { spec: { replicas: 0 } },
      undefined, undefined, undefined, undefined,
      undefined, // force (position 8 — required before options)
      { headers: { 'Content-Type': 'application/merge-patch+json' } }
    );

    const duration = (Date.now() - startTime) / 1000;
    k8sOperationCounter.inc({ operation: 'patch', resource: 'statefulset', status: 'success' });
    k8sOperationDuration.observe({ operation: 'patch', resource: 'statefulset' }, duration);
    simulationEventsCounter.inc({ type: 'db_failure' });

    logger.info('Postgres scaled to 0 — DB failure active');

    res.json({
      success: true,
      data: {
        message: 'Postgres scaled to 0 replicas. Database is down.',
        whatToWatch: [
          `kubectl get pods -n kubelab -w`,
          `kubectl get statefulset -n kubelab`,
          `# Backend will return DB errors — try hitting the API`
        ],
        howToRestore: 'Click "Restore DB" or POST /api/simulate/restore-db'
      }
    });
  } catch (error) {
    k8sOperationCounter.inc({ operation: 'patch', resource: 'statefulset', status: 'error' });
    logger.error('Failed to simulate DB failure', { error: error.message });

    if (error.statusCode === 403) {
      return res.status(403).json({ success: false, error: 'Permission denied. Check RBAC — the backend Role needs statefulsets patch permission.' });
    }
    if (error.statusCode === 404) {
      return res.status(404).json({ success: false, error: 'Postgres StatefulSet not found. Is the app deployed?' });
    }
    next(error);
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// POST /api/simulate/restore-db
// Scales postgres back to 1 replica — database comes back online.
// ─────────────────────────────────────────────────────────────────────────────
router.post('/restore-db', async (req, res, next) => {
  try {
    const { appsV1Api } = getK8sClient();

    logger.info('Restoring DB — scaling postgres back to 1');

    await appsV1Api.patchNamespacedStatefulSet(
      'postgres',
      DEFAULT_NAMESPACE,
      { spec: { replicas: 1 } },
      undefined, undefined, undefined, undefined,
      undefined, // force (position 8 — required before options)
      { headers: { 'Content-Type': 'application/merge-patch+json' } }
    );

    simulationEventsCounter.inc({ type: 'db_restore' });
    logger.info('Postgres scaled back to 1');

    res.json({
      success: true,
      data: {
        message: 'Postgres is coming back online (replicas: 1).',
        whatToWatch: `kubectl get pods -n kubelab -w`
      }
    });
  } catch (error) {
    logger.error('Failed to restore DB', { error: error.message });
    if (error.statusCode === 403) {
      return res.status(403).json({ success: false, error: 'Permission denied. Check RBAC — statefulsets patch is required.' });
    }
    next(error);
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// POST /api/simulate/kill-all-pods
// Deletes ALL backend pods simultaneously — no replicas survive.
//
// With replicas: 2 a single kill leaves 1 replica serving traffic.
// This kills BOTH at once, causing 5-15 seconds of actual application downtime.
// Kubernetes creates 2 replacements immediately, but there is a real gap.
//
// This demonstrates WHY replicas alone don't guarantee uptime without
// PodDisruptionBudgets and pod anti-affinity.
// ─────────────────────────────────────────────────────────────────────────────
router.post('/kill-all-pods', async (req, res, next) => {
  const startTime = Date.now();

  try {
    const { k8sApi } = getK8sClient();
    const namespace = req.body.namespace || DEFAULT_NAMESPACE;

    logger.info('Killing ALL backend pods', { namespace });

    const podsResponse = await k8sApi.listNamespacedPod(
      namespace, undefined, undefined, undefined, undefined, BACKEND_LABEL_SELECTOR
    );
    const pods = podsResponse.body.items;

    if (pods.length === 0) {
      return res.status(404).json({
        success: false,
        error: 'No backend pods found.'
      });
    }

    const killed = [];
    const failed = [];

    await Promise.all(
      pods.map(async (pod) => {
        try {
          await k8sApi.deleteNamespacedPod(pod.metadata.name, namespace);
          killed.push(pod.metadata.name);
          logger.info('Pod killed', { podName: pod.metadata.name });
        } catch (e) {
          failed.push({ podName: pod.metadata.name, error: e.message });
          logger.warn('Failed to kill pod', { podName: pod.metadata.name, error: e.message });
        }
      })
    );

    const duration = (Date.now() - startTime) / 1000;
    k8sOperationDuration.observe({ operation: 'delete', resource: 'pod' }, duration);
    k8sOperationCounter.inc({ operation: 'delete', resource: 'pod', status: 'success' });
    simulationEventsCounter.inc({ type: 'kill_all_pods' });

    res.json({
      success: true,
      data: {
        message: `${killed.length} backend pod(s) deleted simultaneously. Kubernetes is recreating them — expect 5-15s of downtime.`,
        killed,
        failed,
        namespace,
        whatToWatch: [
          'kubectl get pods -n kubelab -w',
          'kubectl get endpoints -n kubelab backend-service',
          '# Watch: both pods Terminating simultaneously, endpoints go empty, new pods start'
        ]
      }
    });
  } catch (error) {
    const duration = (Date.now() - startTime) / 1000;
    k8sOperationDuration.observe({ operation: 'delete', resource: 'pod' }, duration);
    k8sOperationCounter.inc({ operation: 'delete', resource: 'pod', status: 'error' });
    logger.error('Failed to kill all pods', { error: error.message });

    if (error.statusCode === 403) {
      return res.status(403).json({ success: false, error: 'Permission denied. Check RBAC for the backend ServiceAccount.' });
    }
    next(error);
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// POST /api/simulate/fail-readiness
// Makes THIS backend pod fail its readiness probe for 120 seconds.
//
// The pod stays Running and passes its liveness probe — it won't restart.
// But Kubernetes removes it from Service endpoints — it receives NO new traffic.
// The other backend pod handles all requests.
//
// After 120 seconds the probe auto-restores and this pod re-enters the endpoints.
//
// This demonstrates the difference between liveness (is the process alive?) and
// readiness (is the process ready to serve traffic?). Silent degradation — the
// pod is Running in `kubectl get pods` but receiving zero traffic.
// ─────────────────────────────────────────────────────────────────────────────
router.post('/fail-readiness', (req, res) => {
  const readinessState = require('../utils/readiness-state');
  const durationMs = (req.body.durationSeconds || 120) * 1000;
  const podName = process.env.HOSTNAME || 'unknown';

  readinessState.failFor(durationMs);
  simulationEventsCounter.inc({ type: 'readiness_fail' });

  logger.info('Readiness probe simulation started — this pod will not receive traffic', {
    podName,
    durationSeconds: durationMs / 1000,
  });

  res.json({
    success: true,
    data: {
      message: `Readiness probe on "${podName}" will fail for ${durationMs / 1000}s. This pod is now Running but not receiving traffic.`,
      podName,
      durationSeconds: durationMs / 1000,
      whatToWatch: [
        'kubectl get pods -n kubelab',
        '# STATUS stays Running — liveness passes, pod never restarts',
        'kubectl get endpoints -n kubelab backend-service',
        '# This pod\'s IP disappears from endpoints — traffic routes to the other replica',
        'kubectl describe pod -n kubelab <this-pod>',
        '# Conditions: Ready=False, but ContainersReady=True'
      ]
    }
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// POST /api/simulate/restore-readiness
// Manually restores the readiness probe before the auto-restore timer fires.
// ─────────────────────────────────────────────────────────────────────────────
router.post('/restore-readiness', (req, res) => {
  const readinessState = require('../utils/readiness-state');
  const podName = process.env.HOSTNAME || 'unknown';

  readinessState.restore();
  simulationEventsCounter.inc({ type: 'readiness_restore' });

  logger.info('Readiness probe restored', { podName });

  res.json({
    success: true,
    data: {
      message: `Readiness probe on "${podName}" restored. This pod will rejoin Service endpoints within 5-10 seconds.`,
      podName,
      whatToWatch: [
        'kubectl get endpoints -n kubelab backend-service',
        '# This pod\'s IP will reappear once the readiness probe passes'
      ]
    }
  });
});

module.exports = router;
