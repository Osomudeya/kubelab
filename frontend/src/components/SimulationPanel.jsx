/**
 * SimulationPanel — Orchestrator for the failure simulation step machine.
 * Imports sim UI from components/simulation/; holds mutations, state, and step logic.
 */

import { useState, useEffect, useCallback, useRef } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { Trash2, ServerOff, Cpu, HardDrive, Database, Loader2, Search } from 'lucide-react';

import { SIMULATIONS, SIM_ORDER } from '../data/simulations';

const SYMPTOM_MAP = [
  { id: 'exit-137', label: 'Pods restarting unexpectedly (exit code 137)', simId: 'memory-stress', context: 'Exit code 137 = OOMKill. This simulation reproduces it: allocates memory until the kernel sends SIGKILL. You\'ll see exactly what kubectl describe shows after it happens and how to set alerts so you catch it before users do.' },
  { id: 'high-latency', label: 'High latency but pods look healthy', simId: 'cpu-stress', context: 'CPU throttling causes high latency with no visible crash or restart. kubectl top shows normal usage at the ceiling — but the process is frozen 80% of the time. This simulation shows how to confirm throttling with Prometheus and when to raise vs remove CPU limits.' },
  { id: 'partial-503', label: 'App returning 503 on some requests, pods show Running', simId: 'fail-readiness', context: 'A pod can be Running and passing liveness but failing readiness — meaning it\'s alive but receiving zero traffic. This simulation reproduces silent partial outages and shows the exact kubectl output that reveals it.' },
  { id: 'db-crashed', label: 'Database pod crashed, worried about data loss', simId: 'db-failure', context: 'This simulation terminates Postgres completely and brings it back. You\'ll see the PVC stay Bound the entire time — your data is on the volume, not in the pod. Shows exactly what to check after a database pod crash.' },
  { id: 'node-maintenance', label: 'Node needs maintenance, worried about downtime', simId: 'drain-node', context: 'Drain is the correct pattern for zero-downtime node maintenance. This simulation shows exactly what happens during a drain, what PodDisruptionBudgets prevent, and the hidden HA gap that causes downtime despite having replicas: 2.' },
  { id: 'deploy-crashed', label: 'App down after deploying new version', simId: 'kill-all-pods', context: 'A bad deployment that crashes all pods simultaneously looks exactly like this simulation. You\'ll see the endpoint gap, how long the downtime window is, and what PodDisruptionBudgets + anti-affinity do to prevent it.' },
  { id: 'pods-pending', label: 'Pods stuck in Pending after a node failure', simId: 'drain-node', context: 'Pending pods after a node failure usually means the scheduler can\'t place them — often because of PVC affinity or insufficient capacity on remaining nodes. The drain simulation shows this failure mode and what to check with kubectl describe pod.' },
];
import api from '../services/api';
import {
  PreflightCheck,
  TerminalGuide,
  WatchCallout,
  GrafanaCallout,
  WhatYouLearned,
  DeepDivePanel,
  ActiveSimBanner,
  SimCard,
  ObservationBar,
} from './simulation';

const ACCENT_MAP = { red: 'border-red-400 bg-red-50', orange: 'border-orange-400 bg-orange-50', yellow: 'border-yellow-400 bg-yellow-50', rose: 'border-rose-500 bg-rose-50', purple: 'border-purple-400 bg-purple-50' };
const BTN_COLOR_MAP = { red: 'bg-red-600 hover:bg-red-700', orange: 'bg-orange-600 hover:bg-orange-700', yellow: 'bg-yellow-600 hover:bg-yellow-700', rose: 'bg-rose-700 hover:bg-rose-800', purple: 'bg-purple-600 hover:bg-purple-700' };

const COMPLETED_KEY = 'kubelab_completed';

// ─── Pre-flight cluster status check ──────────────────────────────────────────
const PRE_FLIGHT = {
  'kill-pod': (status) => {
    const running = (status?.data?.pods || []).filter(p => p.name?.startsWith('backend') && p.status === 'Running').length;
    if (running < 2) return { ok: false, msg: `Only ${running}/2 backend pods Running — killing one leaves 0 replicas` };
    return { ok: true, msg: `${running} backend pods Running — one kill leaves 1 healthy replica` };
  },
  'drain-node': (status) => {
    const nodes = status?.data?.nodes || [];
    const workers = nodes.filter(n => n.role === 'worker' && !n.unschedulable).length;
    const drained = nodes.find(n => n.role === 'worker' && n.unschedulable);
    if (workers < 2) {
      const uncordonHint = drained
        ? ` Uncordon first: kubectl uncordon ${drained.name}`
        : ' Need at least 2 workers (see setup guide).';
      return { ok: false, msg: `Only ${workers} schedulable worker — evicted pods may stay Pending.${uncordonHint}` };
    }
    return { ok: true, msg: `${workers} schedulable workers available — pods will reschedule` };
  },
  'cpu-stress': (status) => {
    const running = (status?.data?.pods || []).filter(p => p.name?.startsWith('backend') && p.status === 'Running').length;
    return running > 0
      ? { ok: true,  msg: `${running} backend pod${running > 1 ? 's' : ''} Running — stress will target one` }
      : { ok: false, msg: 'No backend pods Running — check cluster health first' };
  },
  'memory-stress': (status) => {
    const running = (status?.data?.pods || []).filter(p => p.name?.startsWith('backend') && p.status === 'Running').length;
    if (running < 2) return { ok: false, msg: `Only ${running}/2 backend pods — OOMKill will briefly drop to 0 replicas` };
    return { ok: true, msg: `${running} backends Running — other replica handles traffic during OOMKill` };
  },
  'db-failure': (status) => {
    const pgRunning = (status?.data?.pods || []).some(p => p.name?.startsWith('postgres') && p.status === 'Running');
    return pgRunning
      ? { ok: true,  msg: 'postgres-0 Running — ready to simulate failure' }
      : { ok: false, msg: 'postgres-0 already down — restore it first' };
  },
  'kill-all-pods': (status) => {
    const running = (status?.data?.pods || []).filter(p => p.name?.startsWith('backend') && p.status === 'Running').length;
    if (running < 2) return { ok: false, msg: `Only ${running}/2 backend pods Running — wait for both to be healthy first` };
    return { ok: true, msg: `${running} backend pods Running — killing both will cause ~10s downtime` };
  },
  'fail-readiness': (status) => {
    const running = (status?.data?.pods || []).filter(p => p.name?.startsWith('backend') && p.status === 'Running').length;
    if (running < 2) return { ok: false, msg: `Only ${running}/2 backend pods Running — need 2 so the other handles traffic` };
    return { ok: true, msg: `${running} backend pods Running — other replica will handle all traffic during probe failure` };
  },
};

// ─── SimulationPanel ──────────────────────────────────────────────────────────
const DEFAULT_OBSERVATION_SECONDS = 12;

const EXPLORE_SEEN_KEY = 'kubelab_explore_seen';

const SimulationPanel = ({ mode = 'guided', onModeChange, activeSim, onActivity, onSimStart, onSimComplete, onObservationState, mockMode = false, expandFirstSim = false, onAckExpandFirstSim }) => {
  const queryClient = useQueryClient();
  const [confirmDialog, setConfirmDialog] = useState(null);
  const [selectedNode, setSelectedNode]   = useState('');
  const [showSymptomDropdown, setShowSymptomDropdown] = useState(false);
  const [debugContext, setDebugContext] = useState(null);
  const [exploreBannerDismissed, setExploreBannerDismissed] = useState(() => {
    try { return !!localStorage.getItem(EXPLORE_SEEN_KEY); } catch { return false; }
  });
  const exploreMode = mode === 'explore';

  const cachedStatus = queryClient.getQueryData(['clusterStatus']);
  const workerNodes  = (cachedStatus?.data?.nodes || [])
    .filter(n => n.role === 'worker' && n.status === 'True' && !n.unschedulable)
    .map(n => n.name);

  const [cpuCountdown, setCpuCountdown]       = useState(0);
  const [memoryCountdown, setMemoryCountdown] = useState(0);
  const drainToastRef = useRef(null);

  const [drainedNode, setDrainedNode]         = useState(null);
  const [dbDown, setDbDown]                   = useState(false);
  const [readinessCountdown, setReadinessCountdown] = useState(0);
  const [terminalReady, setTerminalReady]     = useState({});
  const [expandedSim, setExpandedSim]     = useState('kill-pod');
  const [learnedSim, setLearnedSim]       = useState(null);
  const [completed, setCompleted]         = useState(() => {
    try { return new Set(JSON.parse(localStorage.getItem(COMPLETED_KEY) || '[]')); }
    catch { return new Set(); }
  });

  const [observationCountdown, setObservationCountdown] = useState(null);
  const [observationSimId, setObservationSimId] = useState(null);
  const observationSimIdRef = useRef(null);
  useEffect(() => {
    onObservationState?.({ countdown: observationCountdown, simId: observationSimId });
  }, [observationCountdown, observationSimId, onObservationState]);
  useEffect(() => {
    if (!observationSimId) return;
    observationSimIdRef.current = observationSimId;
    const id = setInterval(() => {
      setObservationCountdown(prev => {
        if (prev <= 1) {
          clearInterval(id);
          const simId = observationSimIdRef.current;
          observationSimIdRef.current = null;
          setObservationSimId(null);
          setLearnedSim(simId);
          onSimComplete?.(simId, true);
          onObservationState?.({ countdown: null, simId: null });
          return null;
        }
        return prev - 1;
      });
    }, 1000);
    return () => clearInterval(id);
  }, [observationSimId, onSimComplete, onObservationState]);

  const focusedSimId = activeSim || observationSimId;
  useEffect(() => {
    if (focusedSimId && mode !== 'explore') setExpandedSim(focusedSimId);
  }, [focusedSimId, mode]);

  useEffect(() => {
    if (!expandFirstSim || !onAckExpandFirstSim) return;
    setExpandedSim('kill-pod');
    const t = setTimeout(() => {
      const el = document.getElementById('sim-kill-pod');
      if (el) el.scrollIntoView({ behavior: 'smooth', block: 'start' });
      onAckExpandFirstSim();
    }, 100);
    return () => clearTimeout(t);
  }, [expandFirstSim, onAckExpandFirstSim]);

  const markCompleted = useCallback((simId) => {
    setCompleted(prev => {
      const next = new Set(prev);
      next.add(simId);
      localStorage.setItem(COMPLETED_KEY, JSON.stringify([...next]));
      return next;
    });
  }, []);

  const handleObservationReveal = useCallback(() => {
    const simId = observationSimId;
    if (!simId) return;
    setLearnedSim(simId);
    setObservationCountdown(null);
    setObservationSimId(null);
    onSimComplete?.(simId, true);
    onObservationState?.({ countdown: null, simId: null });
  }, [observationSimId, onSimComplete, onObservationState]);

  const log = (label, detail, ok = true, narrative = null) =>
    onActivity?.(label, detail, ok, narrative);

  const invalidate = () => {
    queryClient.invalidateQueries({ queryKey: ['clusterStatus'] });
    queryClient.invalidateQueries({ queryKey: ['clusterEvents'] });
  };

  // ── error message helper ───────────────────────────────────────────────────
  const errorMsg = (err, fallback) => {
    const status = err.response?.status;
    if (status === 403) return 'Permission denied — check RBAC configuration';
    if (status === 409) return 'Already running — wait for it to complete';
    return err.response?.data?.error || fallback;
  };

  // ── mutations ──────────────────────────────────────────────────────────────
  const killPodMutation = useMutation({
    mutationFn: () => api.post('/simulate/kill-pod', {}),
    onMutate: () => onSimStart?.('kill-pod'),
    onSuccess: (res) => {
      const pod = res.data.data.podName;
      toast.success(`${pod} deleted`, {
        description: 'ReplicaSet is creating a replacement — watch kubectl get pods -n kubelab',
      });
      markCompleted('kill-pod');
      setExpandedSim('kill-pod');
      log('Kill Pod', `${pod} deleted`, true, {
        emoji: '🔴', explanation: 'The ReplicaSet controller creates a replacement within seconds.',
      });
      if (mode === 'explore') {
        setLearnedSim('kill-pod');
        onSimComplete?.('kill-pod', true);
        onObservationState?.({ countdown: null, simId: null });
      } else {
        setObservationCountdown(SIMULATIONS['kill-pod'].observationWindowSeconds ?? DEFAULT_OBSERVATION_SECONDS);
        setObservationSimId('kill-pod');
      }
      invalidate();
      setConfirmDialog(null);
    },
    onError: (err) => {
      const msg = errorMsg(err, 'Failed to kill pod');
      toast.error('Kill pod failed', { description: msg });
      log('Kill Pod', msg, false, { emoji: '⚠️', explanation: msg });
      onSimComplete?.('kill-pod', false);
      setConfirmDialog(null);
    },
  });

  const drainNodeMutation = useMutation({
    mutationFn: (nodeName) => api.post('/simulate/drain-node', { nodeName }),
    onMutate: (nodeName) => {
      drainToastRef.current = toast.loading(`Draining ${nodeName} — evicting pods (30–60s)`, {
        description: 'Run: kubectl get events -n kubelab -w to watch evictions',
      });
      onSimStart?.('drain-node');
    },
    onSuccess: (res, nodeName) => {
      const { evicted } = res.data.data.summary;
      toast.success(`${nodeName} drained — ${evicted} pods evicted`, {
        id: drainToastRef.current,
        description: 'Run: kubectl get pods -n kubelab -o wide to confirm pod redistribution',
      });
      drainToastRef.current = null;
      setDrainedNode(nodeName);
      markCompleted('drain-node');
      setLearnedSim('drain-node');
      setExpandedSim('drain-node');
      log('Drain Node', `${nodeName} cordoned · ${evicted} evicted`, true, {
        emoji: '🔴', explanation: 'Pods are being rescheduled to healthy nodes.',
      });
      onSimComplete?.('drain-node', true);
      invalidate();
      setConfirmDialog(null);
    },
    onError: (err) => {
      const msg = errorMsg(err, 'Failed to drain node');
      toast.error('Drain failed', { id: drainToastRef.current, description: msg });
      drainToastRef.current = null;
      log('Drain Node', msg, false, { emoji: '⚠️', explanation: msg });
      onSimComplete?.('drain-node', false);
      setConfirmDialog(null);
    },
  });

  const uncordonMutation = useMutation({
    mutationFn: (nodeName) => api.post('/simulate/uncordon-node', { nodeName }),
    onSuccess: (_, nodeName) => {
      toast.success(`${nodeName} is schedulable again`, {
        description: 'New pods can land here. Existing pods don\'t move back automatically.',
      });
      setDrainedNode(null);
      log('Uncordon Node', `${nodeName} restored`, true, {
        emoji: '✅', explanation: 'The node is schedulable again. New pods can land here.',
      });
      invalidate();
    },
    onError: (err) => {
      const msg = errorMsg(err, 'Failed to uncordon node');
      toast.error('Uncordon failed', { description: msg });
      log('Uncordon Node', msg, false, { emoji: '⚠️', explanation: msg });
    },
  });

  const cpuStressMutation = useMutation({
    mutationFn: () => api.post('/simulate/cpu-stress', { durationSeconds: 60 }),
    onMutate: () => onSimStart?.('cpu-stress'),
    onSuccess: (res) => {
      const pod = res.data.data.podName;
      toast.success('CPU stress started — 60s running', {
        description: `Run: kubectl top pods -n kubelab — ${pod} will plateau at 200m (the throttle ceiling)`,
      });
      markCompleted('cpu-stress');
      setExpandedSim('cpu-stress');
      log('CPU Stress', `backend pod throttled for 60s`, true, {
        emoji: '🔴', explanation: 'CPU is pinned at 200m (the limit). Run: watch -n 5 kubectl top pods -n kubelab',
      });
      // for the full 60s so the terminal guide stays visible
      invalidate();
      setConfirmDialog(null);
      setCpuCountdown(60);
      const tick = setInterval(() => {
        setCpuCountdown(prev => {
          if (prev <= 1) {
            clearInterval(tick);
            toast.success('CPU stress complete', {
              description: 'Check Grafana → Node CPU Usage for the 60s spike',
            });
            onSimComplete?.('cpu-stress', true); // ← now transition to "what happened"
            setLearnedSim('cpu-stress');
            return 0;
          }
          return prev - 1;
        });
      }, 1000);
    },
    onError: (err) => {
      const msg = errorMsg(err, 'Failed to start CPU stress');
      toast.error('CPU stress failed', { description: msg });
      log('CPU Stress', msg, false, { emoji: '⚠️', explanation: msg });
      onSimComplete?.('cpu-stress', false);
      setConfirmDialog(null);
    },
  });

  const memoryStressMutation = useMutation({
    mutationFn: () => {
      const status = queryClient.getQueryData(['clusterStatus']);
      const pods = status?.data?.pods || [];
      const backendPods = pods.filter(p => p.name?.startsWith('backend'));
      const target = backendPods.length ? backendPods[0].name : undefined;
      return api.post('/simulate/memory-stress', target ? { target } : {}, target ? { params: { target } } : {});
    },
    onMutate: () => onSimStart?.('memory-stress'),
    onSuccess: (res) => {
      const pod = res.data.data.podName;
      toast.success('Memory stress started — OOMKill incoming', {
        description: `Watch ${pod}: kubectl get pods -n kubelab -w — RESTARTS will increment in ~15s`,
      });
      markCompleted('memory-stress');
      setExpandedSim('memory-stress');
      log('Memory Stress', `${pod} allocating RAM — OOMKill incoming`, true, {
        emoji: '🔴', explanation: 'Watch: kubectl get pods -n kubelab -w — RESTARTS will increment.',
      });
      invalidate();
      setConfirmDialog(null);
      setMemoryCountdown(20);
      const tick = setInterval(() => {
        setMemoryCountdown(prev => {
          if (prev <= 1) {
            clearInterval(tick);
            toast.success('Memory stress window closed', {
              description: 'Run: kubectl describe pod -n kubelab -l app=backend — look for OOMKilled, Exit Code 137',
            });
            onSimComplete?.('memory-stress', true); // ← transition to "what happened"
            setLearnedSim('memory-stress');
            return 0;
          }
          return prev - 1;
        });
      }, 1000);
    },
    onError: (err) => {
      const msg = errorMsg(err, 'Failed to start memory stress');
      toast.error('Memory stress failed', { description: msg });
      log('Memory Stress', msg, false, { emoji: '⚠️', explanation: msg });
      onSimComplete?.('memory-stress', false);
      setConfirmDialog(null);
    },
  });

  const dbFailureMutation = useMutation({
    mutationFn: () => api.post('/simulate/db-failure', {}),
    onMutate: () => onSimStart?.('db-failure'),
    onSuccess: () => {
      toast.success('Postgres scaled to 0 — database is down', {
        description: 'Run: kubectl get pvc -n kubelab — PVC stays Bound, your data is safe',
      });
      setDbDown(true);
      markCompleted('db-failure');
      setExpandedSim('db-failure');
      log('DB Failure', 'postgres → 0 replicas', true, {
        emoji: '🔴', explanation: 'Postgres pod terminated. PVC data is safe.',
      });
      if (mode === 'explore') {
        setLearnedSim('db-failure');
        onSimComplete?.('db-failure', true);
        onObservationState?.({ countdown: null, simId: null });
      } else {
        setObservationCountdown(SIMULATIONS['db-failure'].observationWindowSeconds ?? DEFAULT_OBSERVATION_SECONDS);
        setObservationSimId('db-failure');
      }
      invalidate();
      setConfirmDialog(null);
    },
    onError: (err) => {
      const msg = errorMsg(err, 'Failed to simulate DB failure');
      toast.error('DB failure simulation failed', { description: msg });
      log('DB Failure', msg, false, { emoji: '⚠️', explanation: msg });
      onSimComplete?.('db-failure', false);
      setConfirmDialog(null);
    },
  });

  const restoreDbMutation = useMutation({
    mutationFn: () => api.post('/simulate/restore-db', {}),
    onSuccess: () => {
      toast.success('Postgres is coming back online', {
        description: 'Same PVC reattaches automatically — zero data loss. Watch: kubectl get pods -n kubelab -w',
      });
      setDbDown(false);
      log('Restore DB', 'postgres → 1 replica', true, {
        emoji: '✅', explanation: 'Postgres pod is starting. Same PVC reattached — no data loss.',
      });
      invalidate();
    },
    onError: (err) => {
      const msg = errorMsg(err, 'Failed to restore DB');
      toast.error('Restore DB failed', { description: msg });
      log('Restore DB', msg, false, { emoji: '⚠️', explanation: msg });
    },
  });

  const killAllPodsMutation = useMutation({
    mutationFn: () => api.post('/simulate/kill-all-pods', {}),
    onMutate: () => onSimStart?.('kill-all-pods'),
    onSuccess: (res) => {
      const { killed } = res.data.data;
      toast.success(`${killed.length} backend pods killed — expect ~10s downtime`, {
        description: 'Watch: kubectl get endpoints -n kubelab backend — ENDPOINTS goes empty then refills',
      });
      markCompleted('kill-all-pods');
      setExpandedSim('kill-all-pods');
      log('Kill All Pods', `${killed.length} pods killed simultaneously`, true, {
        emoji: '🔴', explanation: 'Both replicas dead — Service endpoints went empty. Kubernetes is recreating them.',
      });
      if (mode === 'explore') {
        setLearnedSim('kill-all-pods');
        onSimComplete?.('kill-all-pods', true);
        onObservationState?.({ countdown: null, simId: null });
      } else {
        setObservationCountdown(SIMULATIONS['kill-all-pods'].observationWindowSeconds ?? DEFAULT_OBSERVATION_SECONDS);
        setObservationSimId('kill-all-pods');
      }
      invalidate();
      setConfirmDialog(null);
    },
    onError: (err) => {
      const msg = errorMsg(err, 'Failed to kill all pods');
      toast.error('Kill all pods failed', { description: msg });
      log('Kill All Pods', msg, false, { emoji: '⚠️', explanation: msg });
      onSimComplete?.('kill-all-pods', false);
      setConfirmDialog(null);
    },
  });

  const failReadinessMutation = useMutation({
    mutationFn: () => api.post('/simulate/fail-readiness', { durationSeconds: 120 }),
    onMutate: () => onSimStart?.('fail-readiness'),
    onSuccess: (res) => {
      const pod = res.data.data.podName;
      toast.success(`Readiness probe failing on ${pod} for 120s`, {
        description: 'STATUS stays Running — but check endpoints: kubectl get endpoints -n kubelab backend',
      });
      markCompleted('fail-readiness');
      setExpandedSim('fail-readiness');
      log('Readiness Probe Fail', `${pod} removed from endpoints — Running but no traffic`, true, {
        emoji: '🔴', explanation: 'Pod is alive but not in endpoints. Liveness ≠ readiness.',
      });
      invalidate();
      setConfirmDialog(null);
      setReadinessCountdown(120);
      const tick = setInterval(() => {
        setReadinessCountdown(prev => {
          if (prev <= 1) {
            clearInterval(tick);
            toast.success('Readiness probe auto-restored', {
              description: 'Check endpoints again — this pod\'s IP should reappear within 10 seconds',
            });
            onSimComplete?.('fail-readiness', true);
            setLearnedSim('fail-readiness');
            return 0;
          }
          return prev - 1;
        });
      }, 1000);
    },
    onError: (err) => {
      const msg = errorMsg(err, 'Failed to trigger readiness probe failure');
      toast.error('Readiness probe simulation failed', { description: msg });
      log('Readiness Probe Fail', msg, false, { emoji: '⚠️', explanation: msg });
      onSimComplete?.('fail-readiness', false);
      setConfirmDialog(null);
    },
  });

  const restoreReadinessMutation = useMutation({
    mutationFn: () => api.post('/simulate/restore-readiness', {}),
    onSuccess: (res) => {
      const pod = res.data.data.podName;
      toast.success(`Readiness probe restored on ${pod}`, {
        description: 'Pod will rejoin endpoints within 5–10 seconds. Watch: kubectl get endpoints -n kubelab backend',
      });
      setReadinessCountdown(0);
      log('Readiness Restored', `${pod} rejoining endpoints`, true, {
        emoji: '✅', explanation: 'Readiness probe passes. Pod re-enters Service endpoints.',
      });
      onSimComplete?.('fail-readiness', true);
      setLearnedSim('fail-readiness');
      invalidate();
    },
    onError: (err) => {
      const msg = errorMsg(err, 'Failed to restore readiness probe');
      toast.error('Restore readiness failed', { description: msg });
      log('Readiness Restore', msg, false, { emoji: '⚠️', explanation: msg });
    },
  });

  const setReady = (simId, val) => setTerminalReady(p => ({ ...p, [simId]: val }));

  const WithoutNote = ({ without: text }) =>
    text ? (
      <p className="text-xs text-gray-400 italic mb-2 pl-2 border-l-2 border-gray-300 leading-relaxed">
        {text}
      </p>
    ) : null;

  const renderSimBody = (simId) => {
    const sim = SIMULATIONS[simId];
    if (!sim) return null;
    const meta = { ...sim, accent: ACCENT_MAP[sim.accentColor], btnColor: BTN_COLOR_MAP[sim.accentColor] };
    const isReady = !!terminalReady[simId] || exploreMode;

    // Drain node is special — has restore state
    if (simId === 'drain-node') {
      return (
        <>
          <PreflightCheck result={PRE_FLIGHT[simId]?.(cachedStatus)} />
          <WithoutNote without={sim.without} />
          <p className="text-sm text-gray-600 leading-relaxed mb-3">{sim.description}</p>
          <TerminalGuide simId={simId} ready={isReady} onReady={(v) => setReady(simId, v)} skipGate={exploreMode} />
          <WatchCallout items={sim.watch} />
          <div className="flex gap-2 mt-3">
            {drainedNode ? (
              <button
                onClick={() => uncordonMutation.mutate(drainedNode)}
                disabled={uncordonMutation.isPending}
                className="flex items-center gap-2 px-4 py-2 text-sm font-semibold rounded-lg bg-green-600 hover:bg-green-700 text-white disabled:opacity-50 transition-colors"
              >
                {uncordonMutation.isPending && <Loader2 className="w-4 h-4 animate-spin" />}
                Uncordon {drainedNode}
              </button>
            ) : (
              <button
                onClick={() => {
                  const pfResult = PRE_FLIGHT['drain-node']?.(cachedStatus);
                  if (pfResult && !pfResult.ok) { toast.error(pfResult.msg); return; }
                  const preset = workerNodes.length === 1 ? workerNodes[0] : '';
                  setSelectedNode(preset);
                  setConfirmDialog({
                    title: 'Drain Worker Node',
                    message: workerNodes.length === 0
                      ? 'No schedulable worker nodes found. Check cluster status.'
                      : workerNodes.length === 1
                        ? `Cordon and drain "${workerNodes[0]}"? All non-DaemonSet pods will be evicted and rescheduled.`
                        : 'Select a worker node to cordon and drain.',
                    nodeSelect: workerNodes.length > 1,
                    disabled: workerNodes.length === 0,
                    onConfirm: (n) => { if (n?.trim()) drainNodeMutation.mutate(n.trim()); else setConfirmDialog(null); },
                    isLoading: drainNodeMutation.isPending,
                  });
                }}
                disabled={drainNodeMutation.isPending || !isReady}
                title={!isReady ? 'Open your terminal and check the box above first' : undefined}
                className={`flex items-center gap-2 px-4 py-2 text-sm font-semibold rounded-lg text-white disabled:opacity-50 transition-colors ${meta.btnColor}`}
              >
                {drainNodeMutation.isPending && <Loader2 className="w-4 h-4 animate-spin" />}
                Drain Worker Node
              </button>
            )}
          </div>
          <DeepDivePanel simId={simId} defaultOpen={exploreMode} />
          {learnedSim === simId && <WhatYouLearned simId={simId} onDismiss={() => setLearnedSim(null)} onNext={(id) => { setLearnedSim(null); setExpandedSim(id); }} exploreMode={exploreMode} />}
        </>
      );
    }

    // DB failure is special — has restore state
    if (simId === 'db-failure') {
      return (
        <>
          <PreflightCheck result={PRE_FLIGHT[simId]?.(cachedStatus)} />
          <WithoutNote without={sim.without} />
          <p className="text-sm text-gray-600 leading-relaxed mb-3">{sim.description}</p>
          <TerminalGuide simId={simId} ready={isReady} onReady={(v) => setReady(simId, v)} skipGate={exploreMode} />
          <WatchCallout items={sim.watch} />
          <div className="flex gap-2 mt-3">
            {dbDown ? (
              <button
                onClick={() => restoreDbMutation.mutate()}
                disabled={restoreDbMutation.isPending}
                className="flex items-center gap-2 px-4 py-2 text-sm font-semibold rounded-lg bg-green-600 hover:bg-green-700 text-white disabled:opacity-50 transition-colors"
              >
                {restoreDbMutation.isPending && <Loader2 className="w-4 h-4 animate-spin" />}
                Restore Database
              </button>
            ) : (
              <button
                onClick={() => {
                  const pfResult = PRE_FLIGHT['db-failure']?.(cachedStatus);
                  if (pfResult && !pfResult.ok) { toast.error(pfResult.msg); return; }
                  setConfirmDialog({
                  title: 'Simulate Database Failure',
                  message: 'Postgres StatefulSet will be scaled to 0. The database pod terminates. PVC data is safe.',
                  onConfirm: () => dbFailureMutation.mutate(),
                  isLoading: dbFailureMutation.isPending,
                  });
                }}
                disabled={dbFailureMutation.isPending || !isReady}
                title={!isReady ? 'Open your terminal and check the box above first' : undefined}
                className={`flex items-center gap-2 px-4 py-2 text-sm font-semibold rounded-lg text-white disabled:opacity-50 transition-colors ${meta.btnColor}`}
              >
                {dbFailureMutation.isPending && <Loader2 className="w-4 h-4 animate-spin" />}
                Simulate DB Failure
              </button>
            )}
          </div>
          <DeepDivePanel simId={simId} defaultOpen={exploreMode} />
          {learnedSim === simId && <WhatYouLearned simId={simId} onDismiss={() => setLearnedSim(null)} onNext={(id) => { setLearnedSim(null); setExpandedSim(id); }} exploreMode={exploreMode} />}
        </>
      );
    }

    // Kill all pods — cascading failure with real downtime
    if (simId === 'kill-all-pods') {
      return (
        <>
          <PreflightCheck result={PRE_FLIGHT[simId]?.(cachedStatus)} />
          <WithoutNote without={sim.without} />
          <p className="text-sm text-gray-600 leading-relaxed mb-3">{sim.description}</p>
          <TerminalGuide simId={simId} ready={isReady} onReady={(v) => setReady(simId, v)} skipGate={exploreMode} />
          <WatchCallout items={sim.watch} />
          <div className="mt-3">
            <button
              onClick={() => {
                const pfResult = PRE_FLIGHT['kill-all-pods']?.(cachedStatus);
                if (pfResult && !pfResult.ok) { toast.error(pfResult.msg); return; }
                setConfirmDialog({
                  title: 'Kill ALL Backend Pods',
                  message: 'Both backend replicas will be deleted simultaneously. The Service will have zero endpoints for 5–15 seconds — this is real downtime. Kubernetes will recreate both pods automatically.',
                  onConfirm: () => killAllPodsMutation.mutate(),
                  isLoading: killAllPodsMutation.isPending,
                });
              }}
              disabled={killAllPodsMutation.isPending || !isReady}
              title={!isReady ? 'Open your terminal and check the box above first' : undefined}
              className={`flex items-center gap-2 px-4 py-2 text-sm font-semibold rounded-lg text-white disabled:opacity-50 transition-colors ${meta.btnColor}`}
            >
              {killAllPodsMutation.isPending && <Loader2 className="w-4 h-4 animate-spin" />}
              Kill All Backend Pods
            </button>
          </div>
          <DeepDivePanel simId={simId} defaultOpen={exploreMode} />
          {learnedSim === simId && <WhatYouLearned simId={simId} onDismiss={() => setLearnedSim(null)} onNext={(id) => { setLearnedSim(null); setExpandedSim(id); }} exploreMode={exploreMode} />}
        </>
      );
    }

    // Readiness probe failure — toggle with countdown + restore
    if (simId === 'fail-readiness') {
      const isActive = readinessCountdown > 0;
      return (
        <>
          <PreflightCheck result={PRE_FLIGHT[simId]?.(cachedStatus)} />
          <WithoutNote without={sim.without} />
          <p className="text-sm text-gray-600 leading-relaxed mb-3">{sim.description}</p>
          <TerminalGuide simId={simId} ready={isReady} onReady={(v) => setReady(simId, v)} skipGate={exploreMode} />
          <WatchCallout items={sim.watch} />
          {isActive && (
            <div className="mt-2 mb-3 flex items-center gap-2 text-xs bg-purple-50 border border-purple-200 rounded-lg px-3 py-2">
              <span className="text-purple-600 font-mono animate-pulse">●</span>
              <span className="text-purple-700 font-medium">Probe failing — auto-restores in</span>
              <span className="text-purple-800 font-mono font-bold tabular-nums">{readinessCountdown}s</span>
              <div className="flex-1 h-1 bg-purple-200 rounded overflow-hidden ml-2">
                <div
                  className="h-full bg-purple-500 transition-all duration-1000"
                  style={{ width: `${(readinessCountdown / 120) * 100}%` }}
                />
              </div>
            </div>
          )}
          <div className="flex gap-2 mt-3">
            {isActive ? (
              <button
                onClick={() => restoreReadinessMutation.mutate()}
                disabled={restoreReadinessMutation.isPending}
                className="flex items-center gap-2 px-4 py-2 text-sm font-semibold rounded-lg bg-green-600 hover:bg-green-700 text-white disabled:opacity-50 transition-colors"
              >
                {restoreReadinessMutation.isPending && <Loader2 className="w-4 h-4 animate-spin" />}
                Restore Readiness Now
              </button>
            ) : (
              <button
                onClick={() => {
                  const pfResult = PRE_FLIGHT['fail-readiness']?.(cachedStatus);
                  if (pfResult && !pfResult.ok) { toast.error(pfResult.msg); return; }
                  setConfirmDialog({
                    title: 'Fail Readiness Probe (120s)',
                    message: 'One backend pod will fail its readiness probe for 120 seconds. It stays Running — no restart. But Kubernetes removes it from Service endpoints. All traffic routes to the other pod. Auto-restores after 120s.',
                    onConfirm: () => failReadinessMutation.mutate(),
                    isLoading: failReadinessMutation.isPending,
                  });
                }}
                disabled={failReadinessMutation.isPending || !isReady}
                title={!isReady ? 'Open your terminal and check the box above first' : undefined}
                className={`flex items-center gap-2 px-4 py-2 text-sm font-semibold rounded-lg text-white disabled:opacity-50 transition-colors ${meta.btnColor}`}
              >
                {failReadinessMutation.isPending && <Loader2 className="w-4 h-4 animate-spin" />}
                Fail Readiness Probe (120s)
              </button>
            )}
          </div>
          <DeepDivePanel simId={simId} defaultOpen={exploreMode} />
          {learnedSim === simId && <WhatYouLearned simId={simId} onDismiss={() => setLearnedSim(null)} onNext={(id) => { setLearnedSim(null); setExpandedSim(id); }} exploreMode={exploreMode} />}
        </>
      );
    }

    // Generic sims (kill-pod, cpu-stress, memory-stress)
    const mutationMap = {
      'kill-pod':      { mutation: killPodMutation,      confirm: null },
      'cpu-stress':    { mutation: cpuStressMutation,    confirm: { title: 'CPU Stress — Throttling', message: 'This will burn CPU inside a backend pod for 60 seconds. That pod will be throttled to 200m by Kubernetes. It stays alive — just slow. Make sure "watch -n 5 kubectl top pods -n kubelab" is open in your terminal first.' } },
      'memory-stress': { mutation: memoryStressMutation, confirm: { title: 'Memory Stress — OOMKill', message: 'This will allocate memory inside a backend pod until it exceeds its 256 Mi limit. The kernel will OOMKill that pod (exit code 137). The other backend replica keeps serving traffic. Make sure "kubectl get pods -n kubelab -w" is open first.' } },
    };
    const entry = mutationMap[simId];
    const isCpuActive    = simId === 'cpu-stress'    && cpuCountdown > 0;
    const isMemoryActive = simId === 'memory-stress' && memoryCountdown > 0;
    const handleClick = () => {
      if (isCpuActive || isMemoryActive) return;
      const checkFn = PRE_FLIGHT[simId];
      if (checkFn) {
        const result = checkFn(cachedStatus);
        if (!result.ok) { toast.error(result.msg); return; }
      }
      if (!entry.confirm) { entry.mutation.mutate(); return; }
      setConfirmDialog({ ...entry.confirm, onConfirm: () => entry.mutation.mutate(), isLoading: entry.mutation.isPending });
    };

    const btnLabel = () => {
      if (simId === 'kill-pod')      return 'Kill Random Pod';
      if (simId === 'cpu-stress')    return isCpuActive    ? `CPU Stress Active (${cpuCountdown}s)`    : 'Start CPU Stress (60s)';
      if (simId === 'memory-stress') return isMemoryActive ? `OOMKill Window (~${memoryCountdown}s)` : 'Start Memory Stress';
      return 'Trigger';
    };

    return (
      <>
        {!exploreMode && simId === 'kill-pod' && !completed.has('kill-pod') && (
          <div className="mb-4 rounded-lg bg-blue-50 border border-blue-200 px-4 py-2.5 text-sm text-blue-900">
            <strong>Start here.</strong> Open a terminal, run the command below, check the box, then click Run.
          </div>
        )}
        <PreflightCheck result={PRE_FLIGHT[simId]?.(cachedStatus)} />
        <WithoutNote without={sim.without} />
        <p className="text-sm text-gray-600 leading-relaxed mb-3">{sim.description}</p>
        <TerminalGuide simId={simId} ready={isReady} onReady={(v) => setReady(simId, v)} skipGate={exploreMode} />
        {sim.grafana && <GrafanaCallout simId={simId} />}
        <WatchCallout items={sim.watch} />
        <div className="mt-3 flex items-center gap-3 flex-wrap">
          <button
            onClick={handleClick}
            disabled={entry.mutation.isPending || isCpuActive || isMemoryActive || !isReady}
            title={!isReady ? 'Open your terminal and check the box above first' : undefined}
            className={`flex items-center gap-2 px-4 py-2 text-sm font-semibold rounded-lg text-white disabled:opacity-60 transition-colors ${meta.btnColor}`}
          >
            {entry.mutation.isPending && <Loader2 className="w-4 h-4 animate-spin" />}
            {btnLabel()}
          </button>
          {isCpuActive && (
            <span className="text-xs text-yellow-600 font-mono animate-pulse">
              ⏱ throttling backend pod — check kubectl top pods
            </span>
          )}
          {isMemoryActive && (
            <span className="text-xs text-red-600 font-mono animate-pulse">
              ⏱ OOMKill incoming — watch kubectl get pods -w
            </span>
          )}
        </div>
        <DeepDivePanel simId={simId} defaultOpen={exploreMode} />
        {learnedSim === simId && <WhatYouLearned simId={simId} onDismiss={() => setLearnedSim(null)} onNext={(id) => { setLearnedSim(null); setExpandedSim(id); }} exploreMode={exploreMode} />}
      </>
    );
  };

  const LOADING_MAP = {
    'kill-pod':      killPodMutation.isPending,
    'drain-node':    drainNodeMutation.isPending || uncordonMutation.isPending,
    'cpu-stress':    cpuStressMutation.isPending || cpuCountdown > 0,
    'memory-stress': memoryStressMutation.isPending || memoryCountdown > 0,
    'db-failure':    dbFailureMutation.isPending || restoreDbMutation.isPending,
    'kill-all-pods': killAllPodsMutation.isPending,
    'fail-readiness': failReadinessMutation.isPending || restoreReadinessMutation.isPending || readinessCountdown > 0,
  };

  const LABEL_MAP = {
    'kill-pod':      'Kill Random Pod',
    'drain-node':    drainedNode ? `Drain Node (${drainedNode} cordoned)` : 'Drain Worker Node',
    'cpu-stress':    'CPU Stress (60s)',
    'memory-stress': 'Memory Stress (OOMKill)',
    'db-failure':    dbDown ? 'DB Failure (Restore available)' : 'Simulate DB Failure',
    'kill-all-pods': 'Cascading Pod Failure',
    'fail-readiness': readinessCountdown > 0 ? `Readiness Failing (${readinessCountdown}s)` : 'Readiness Probe Failure',
  };

  const simIds = SIM_ORDER;
  const completedCount = simIds.filter(id => completed.has(id)).length;
  const remainingCount = simIds.length - completedCount;

  const handleSymptomSelect = useCallback((entry) => {
    setShowSymptomDropdown(false);
    onModeChange?.('explore');
    setExpandedSim(entry.simId);
    setDebugContext({ simId: entry.simId, label: entry.label, context: entry.context });
    setTimeout(() => {
      const el = document.getElementById(`sim-${entry.simId}`);
      if (el) el.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }, 100);
  }, [onModeChange]);

  const dismissExploreBanner = useCallback(() => {
    try { localStorage.setItem(EXPLORE_SEEN_KEY, '1'); } catch (_) {}
    setExploreBannerDismissed(true);
  }, []);

  return (
    <>
      <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-6">
        {exploreMode && !exploreBannerDismissed && (
          <div className="mb-4 flex items-start justify-between gap-4 rounded-lg border border-orange-200 bg-orange-50 px-4 py-3">
            <p className="text-sm text-orange-900">
              <span className="font-semibold">⚡ Explore mode</span> — all simulations unlocked. No gates, no sequence. Deep dive sections default open. Run anything in any order. Switch back to Guided mode anytime from the header.
            </p>
            <button onClick={dismissExploreBanner} className="shrink-0 text-xs font-semibold text-orange-700 hover:text-orange-900 px-2 py-1 rounded">Got it</button>
          </div>
        )}
        <div className="flex items-center justify-between mb-5">
          <div>
            <h2 className="text-lg font-bold text-gray-900">Failure Simulations</h2>
            <p className="text-xs text-gray-400 mt-0.5">
              {mockMode ? '⚠ Mock mode — connect a real cluster to run these' : 'Real Kubernetes API — nothing mocked'}
            </p>
          </div>
          <div className="flex items-center gap-3 relative">
            <div className="relative">
              <button
                type="button"
                onClick={() => setShowSymptomDropdown(p => !p)}
                className="flex items-center gap-1.5 text-xs px-2.5 py-1.5 rounded-lg border border-gray-200 hover:border-gray-400 transition-colors"
              >
                <Search className="w-3.5 h-3.5 text-gray-400" />
                <span className="text-gray-600">I&apos;m debugging...</span>
              </button>
              {showSymptomDropdown && (
                <>
                  <div className="fixed inset-0 z-10" onClick={() => setShowSymptomDropdown(false)} aria-hidden="true" />
                  <div className="absolute left-0 top-full mt-1 z-20 w-80 max-h-[70vh] overflow-y-auto rounded-lg border border-gray-200 bg-white shadow-lg py-2">
                    <p className="px-3 py-1.5 text-xs font-semibold text-gray-500 uppercase">What are you seeing in production?</p>
                    {SYMPTOM_MAP.map((entry) => (
                      <button
                        key={entry.id}
                        type="button"
                        onClick={() => handleSymptomSelect(entry)}
                        className="w-full text-left px-3 py-2.5 text-sm text-gray-700 hover:bg-orange-50 hover:text-orange-900"
                      >
                        {entry.label}
                      </button>
                    ))}
                  </div>
                </>
              )}
            </div>
            {/* Progress dots — one per sim; aria-label + title for accessibility */}
            <div className="flex items-center gap-1.5" role="progressbar" aria-valuenow={completedCount} aria-valuemin={0} aria-valuemax={simIds.length} aria-label={`Simulations completed: ${completedCount} of ${simIds.length}`}>
              <div className="flex gap-1">
                {simIds.map(id => (
                  <span
                    key={id}
                    className={`w-2 h-2 rounded-full transition-colors ${completed.has(id) ? 'bg-green-500' : 'bg-gray-200'}`}
                    title={`${SIMULATIONS[id]?.label ?? id}: ${completed.has(id) ? 'complete' : 'not yet completed'}`}
                    aria-label={`Simulation ${SIMULATIONS[id]?.number ?? id}: ${SIMULATIONS[id]?.label ?? id} — ${completed.has(id) ? 'complete' : 'not yet completed'}`}
                  />
                ))}
              </div>
              <span className="text-xs text-gray-500">{completedCount}/{simIds.length}</span>
            </div>
            {remainingCount > 0 && (
              <span className="text-xs text-gray-400 tabular-nums" title="Estimated time for remaining simulations">
                ~{remainingCount * 3}–{remainingCount * 15} min left
              </span>
            )}
            {remainingCount === 0 && (
              <span className="text-xs text-green-600 font-semibold">All done 🎉</span>
            )}
          </div>
        </div>

        <ActiveSimBanner
          cpuCountdown={cpuCountdown}
          memoryCountdown={memoryCountdown}
          drainPending={drainNodeMutation.isPending}
        />

        <div className={`space-y-2 ${mockMode ? 'opacity-50 pointer-events-none select-none' : ''}`}>
          {simIds.map((simId) => {
            const effectiveExpanded = exploreMode ? expandedSim : (focusedSimId || expandedSim);
            const isExpanded = effectiveExpanded === simId;
            const canExpand = exploreMode ? true : (!focusedSimId || simId === focusedSimId);
            return (
            <SimCard
              key={simId}
              simId={simId}
              isExpanded={isExpanded}
              isCompleted={completed.has(simId)}
              isActive={LOADING_MAP[simId]}
              isDimmed={!exploreMode && !!focusedSimId && focusedSimId !== simId}
              canExpand={canExpand}
              label={LABEL_MAP[simId]}
              isLoading={LOADING_MAP[simId]}
              onToggle={() => {
                if (!canExpand && !isExpanded) return;
                setExpandedSim(prev => prev === simId ? null : simId);
              }}
            >
              {!exploreMode && simId === observationSimId && observationCountdown != null && (
                <ObservationBar
                  countdown={observationCountdown}
                  onReveal={handleObservationReveal}
                  observePrompt={SIMULATIONS[observationSimId]?.observe?.prompt}
                  totalSeconds={SIMULATIONS[observationSimId]?.observationWindowSeconds ?? DEFAULT_OBSERVATION_SECONDS}
                />
              )}
              {debugContext?.simId === simId && (
                <div className="mb-4 rounded-lg border border-orange-200 bg-orange-50 px-4 py-3">
                  <p className="text-sm font-semibold text-orange-900">🔍 Debugging: &quot;{debugContext.label}&quot;</p>
                  <p className="text-xs text-orange-800 mt-1 leading-relaxed">{debugContext.context}</p>
                </div>
              )}
              {renderSimBody(simId)}
            </SimCard>
            );
          })}
        </div>

        {/* All done */}
        {completedCount === simIds.length && (
          <div className="mt-5 p-4 bg-green-50 border border-green-200 rounded-xl text-center">
            <p className="text-lg">🎉</p>
            <p className="text-sm font-bold text-green-800 mt-1">All simulations completed!</p>
            <p className="text-xs text-green-700 mt-1">
              You&#39;ve experienced self-healing, node drain, CPU throttling, OOMKill, and stateful failure recovery.
            </p>
          </div>
        )}
      </div>

      {/* Confirmation dialog */}
      {confirmDialog && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
          <div className="bg-white rounded-xl shadow-xl p-6 max-w-md w-full mx-4">
            <h3 className="text-lg font-semibold text-gray-900 mb-2">{confirmDialog.title}</h3>
            <p className="text-sm text-gray-600 mb-4">{confirmDialog.message}</p>

            {/* Node selector — replaces free-text input */}
            {confirmDialog.nodeSelect && (
              <select
                value={selectedNode}
                onChange={(e) => setSelectedNode(e.target.value)}
                autoFocus
                className="w-full px-3 py-2 border border-gray-300 rounded-lg mb-4 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white"
              >
                <option value="">— pick a node —</option>
                {workerNodes.map(n => (
                  <option key={n} value={n}>{n}</option>
                ))}
              </select>
            )}

            <div className="flex justify-end gap-3">
              <button
                onClick={() => setConfirmDialog(null)}
                disabled={confirmDialog.isLoading}
                className="px-4 py-2 text-sm font-medium text-gray-700 bg-gray-100 rounded-lg hover:bg-gray-200 disabled:opacity-50"
              >
                Cancel
              </button>
              <button
                onClick={() => {
                  if (confirmDialog.nodeSelect) {
                    confirmDialog.onConfirm(selectedNode);
                  } else if (confirmDialog.disabled) {
                    setConfirmDialog(null);
                  } else {
                    // single worker — already in selectedNode
                    confirmDialog.onConfirm(selectedNode || workerNodes[0] || '');
                  }
                }}
                disabled={confirmDialog.isLoading || confirmDialog.disabled || (confirmDialog.nodeSelect && !selectedNode)}
                className="px-4 py-2 text-sm font-medium text-white bg-red-600 rounded-lg hover:bg-red-700 disabled:opacity-50 flex items-center gap-2"
              >
                {confirmDialog.isLoading && <Loader2 className="w-4 h-4 animate-spin" />}
                {confirmDialog.disabled ? 'OK' : 'Confirm'}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
};

export default SimulationPanel;
