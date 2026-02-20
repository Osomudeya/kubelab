/**
 * SimFlashcard
 *
 * Auto-appears the moment a simulation is triggered — no clicking required.
 *
 * Phase 1 (watching): "Run this in your terminal RIGHT NOW"
 *   → exact kubectl commands + what to look for in the output
 *
 * Phase 2 (learned): "What just happened and why it matters"
 *   → plain-language explanation + production context
 *
 * Dismisses on X or automatically 60s after phase 2 starts.
 */

import { useState, useEffect, useCallback } from 'react';
import { Terminal, X, ArrowRight, CheckCircle2, Copy, Check } from 'lucide-react';

// ─── Per-simulation content ───────────────────────────────────────────────────
const CONTENT = {
  'kill-pod': {
    title: 'Kill Random Pod',
    color: 'border-red-500 bg-red-950/30',
    headerColor: 'text-red-400',
    happening: 'A backend pod was deleted. Kubernetes is creating a replacement right now.',
    commands: [
      {
        cmd: 'kubectl get pods -n kubelab -w',
        watch: 'Look for: Running → Terminating (old pod), then Pending → Running (new pod)',
      },
      {
        cmd: 'kubectl get events -n kubelab --sort-by=.lastTimestamp | tail -10',
        watch: 'Look for: Killing → SuccessfulCreate → Scheduled → Pulled → Started',
      },
    ],
    learned: 'The ReplicaSet controller noticed actual count (1) ≠ desired count (2) and immediately created a replacement pod. The scheduler placed it and the readiness probe passed — all in 3–8 seconds.',
    production: 'Node crashes, OOM kills, and process crashes all trigger this same loop. With replicas > 1 and a readiness probe, your app survives any single pod death with zero downtime.',
  },

  'drain-node': {
    title: 'Drain Worker Node',
    color: 'border-orange-500 bg-orange-950/30',
    headerColor: 'text-orange-400',
    happening: 'The node is being cordoned (unschedulable) and all pods are being evicted.',
    commands: [
      {
        cmd: 'kubectl get nodes',
        watch: 'Look for: SchedulingDisabled next to the drained node\'s STATUS',
      },
      {
        cmd: 'kubectl get pods -n kubelab -o wide -w',
        watch: 'Watch pods evict from the drained node and reappear on other nodes',
      },
    ],
    learned: 'Cordon blocked new pods from landing on the node. Eviction sent SIGTERM to each pod (respecting PodDisruptionBudgets). The scheduler placed replacements on remaining healthy nodes.',
    production: 'Every kernel patch, node upgrade, or cloud provider maintenance uses this pattern. Without a PodDisruptionBudget, if both replicas landed on the same node you just had zero-replica downtime.',
  },

  'cpu-stress': {
    title: 'CPU Stress — Throttling',
    color: 'border-yellow-500 bg-yellow-950/30',
    headerColor: 'text-yellow-400',
    happening: 'A backend pod is burning CPU right now. Its 200m limit means the Linux scheduler is throttling it hard — the pod stays alive, just slow.',
    commands: [
      {
        cmd: 'kubectl top pods -n kubelab',
        watch: 'One backend pod will show ~200m CPU (the limit ceiling). Run this every 5s to watch the plateau.',
      },
      {
        cmd: 'kubectl get pods -n kubelab',
        watch: 'Both backend pods stay Running. CPU throttling does NOT restart pods — only OOMKill does.',
      },
    ],
    learned: 'The kernel\'s CFS (Completely Fair Scheduler) throttled the backend container at 200m. The process ran continuously — but was paused 80% of the time to enforce the limit. No crash, no restart. Just latency.',
    production: 'Throttling is invisible to kubectl top — it shows usage at the ceiling, not how much was denied. High latency with "normal-looking" CPU = check container_cpu_cfs_throttled_seconds_total in Prometheus. Raise the limit or fix the hotspot.',
  },

  'memory-stress': {
    title: 'Memory Stress — OOMKill',
    color: 'border-red-500 bg-red-950/30',
    headerColor: 'text-red-400',
    happening: 'A backend pod is allocating memory in chunks right now. It will cross the 256 Mi limit and get killed by the kernel with no warning.',
    commands: [
      {
        cmd: 'kubectl get pods -n kubelab -w',
        watch: 'Watch RESTARTS increment on a backend pod. No "Terminating" phase — OOMKill is instant.',
      },
      {
        cmd: 'kubectl describe pod -n kubelab -l app=backend',
        watch: 'Under "Last State": Reason: OOMKilled, Exit Code: 137. That\'s 128 + signal 9 (SIGKILL).',
      },
    ],
    learned: 'Your actual backend pod crossed its 256 Mi memory ceiling. The Linux kernel sent SIGKILL instantly — no warning, no cleanup, no SIGTERM. Kubernetes saw the container die, incremented the restart count, and started a fresh container in the same pod. The other backend replica kept serving traffic the entire time.',
    production: 'OOMKilled pods restart silently. Restart count climbs over days. Nobody notices until the pod is restarting every hour. Alert on kube_pod_container_status_restarts_total > 5. Fix the leak or raise the limit.',
  },

  'db-failure': {
    title: 'Database Failure',
    color: 'border-red-600 bg-red-950/40',
    headerColor: 'text-red-400',
    happening: 'Postgres StatefulSet scaled to 0. The pod is terminating. Your data is safe on the PVC.',
    commands: [
      {
        cmd: 'kubectl get pods -n kubelab -w | grep postgres',
        watch: 'Watch postgres-0 go Running → Terminating → disappear',
      },
      {
        cmd: 'kubectl get pvc -n kubelab',
        watch: 'PVC stays Bound even while the pod is gone — data is on the volume, not in the pod',
      },
    ],
    learned: 'Scaling to 0 deleted the pod but preserved the PersistentVolumeClaim. Postgres did a clean checkpoint before shutdown (you\'ll see "database system was shut down" in the logs on restore). The StatefulSet guarantees postgres-0 gets the same PVC on restart.',
    production: 'Apps without connection retry logic return 500s immediately and stay broken even after Postgres restores. Connection pools that don\'t validate on acquire are the worst offenders — they hold a dead connection forever.',
  },

  'kill-all-pods': {
    title: 'Cascading Pod Failure',
    color: 'border-red-700 bg-red-950/50',
    headerColor: 'text-red-300',
    happening: 'ALL backend pods were deleted simultaneously. The Service has zero healthy endpoints right now — requests are failing. Kubernetes is creating replacements.',
    commands: [
      {
        cmd: 'kubectl get pods -n kubelab -w',
        watch: 'Both backend pods Terminating at the same time. Watch for new pods: Pending → ContainerCreating → Running',
      },
      {
        cmd: 'kubectl get endpoints -n kubelab backend',
        watch: 'Addresses list is empty during the gap. It refills when new pods pass their readiness probe.',
      },
    ],
    learned: 'With replicas:2 and both pods dead, the Service endpoint list was empty for 5–15 seconds — real downtime. Kubernetes recreated both pods, but traffic was rejected until readiness probes passed. A PodDisruptionBudget (minAvailable: 1) would have prevented this by blocking simultaneous deletion.',
    production: 'This is what a bad rolling deploy looks like if maxUnavailable is set too high. It also happens when someone runs kubectl delete pods --all without thinking. PodDisruptionBudgets are the safety net — set one for every production Deployment.',
  },

  'fail-readiness': {
    title: 'Readiness Probe Failure',
    color: 'border-purple-500 bg-purple-950/30',
    headerColor: 'text-purple-400',
    happening: 'One backend pod is returning 503 from its /ready endpoint. Kubernetes is removing it from the Service endpoints — it will receive zero traffic, but the pod stays Running.',
    commands: [
      {
        cmd: 'kubectl get pods -n kubelab -l app=backend',
        watch: 'One pod shows READY 0/1. It stays Running. That\'s the difference from a crash.',
      },
      {
        cmd: 'kubectl get endpoints -n kubelab backend',
        watch: 'Only one IP listed — the healthy replica. The failing pod\'s IP is absent.',
      },
    ],
    learned: 'The pod was alive but not ready. Kubernetes removed it from the Service endpoint list so no new traffic was routed to it. The other replica handled 100% of requests. After 2 minutes the readiness probe recovered automatically and the pod rejoined the endpoint list.',
    production: 'Liveness probes restart pods. Readiness probes control traffic. A pod stuck in a degraded state (slow DB, full queue, warming cache) should fail readiness — not crash. This keeps it out of the load balancer until it\'s actually ready to serve.',
  },
};

// ─── Copy button ──────────────────────────────────────────────────────────────
const CopyButton = ({ text }) => {
  const [copied, setCopied] = useState(false);
  const copy = useCallback(() => {
    navigator.clipboard.writeText(text).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  }, [text]);

  return (
    <button
      onClick={copy}
      className="flex-shrink-0 flex items-center gap-1 text-xs text-gray-500 hover:text-gray-300 transition-colors"
    >
      {copied ? <Check className="w-3.5 h-3.5 text-green-400" /> : <Copy className="w-3.5 h-3.5" />}
      {copied ? 'Copied' : 'Copy'}
    </button>
  );
};

// ─── SimFlashcard ─────────────────────────────────────────────────────────────
const SimFlashcard = ({ activeSim, lastCompletedSim, onDismiss }) => {
  const simId = activeSim || lastCompletedSim;
  const isWatching = activeSim !== null;
  const content = CONTENT[simId];

  // Auto-dismiss 60s after simulation completes
  useEffect(() => {
    if (!isWatching && lastCompletedSim) {
      const t = setTimeout(onDismiss, 60000);
      return () => clearTimeout(t);
    }
  }, [isWatching, lastCompletedSim, onDismiss]);

  if (!content) return null;

  return (
    <div className={`rounded-xl border-2 ${content.color} p-5 transition-all duration-300`}>
      {/* Header */}
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-2">
          {isWatching
            ? <Terminal className={`w-4 h-4 ${content.headerColor} animate-pulse`} />
            : <CheckCircle2 className="w-4 h-4 text-green-400" />
          }
          <span className={`text-sm font-bold ${isWatching ? content.headerColor : 'text-green-400'}`}>
            {isWatching ? `${content.title} — running. Switch to your terminal now ↓` : `${content.title} — what just happened`}
          </span>
        </div>
        {!isWatching && (
          <button onClick={onDismiss} className="text-gray-600 hover:text-gray-400 transition-colors">
            <X className="w-4 h-4" />
          </button>
        )}
      </div>

      {/* Phase 1: Watching — terminal commands */}
      {isWatching && (
        <>
          <p className="text-sm text-gray-300 mb-4 leading-relaxed">{content.happening}</p>
          <div className="space-y-3">
            {content.commands.map((c) => (
              <div key={c.cmd} className="space-y-1.5">
                <div className="flex items-center gap-2 bg-black/50 rounded-lg px-3 py-2">
                  <span className="text-green-400 font-mono text-xs select-none flex-shrink-0">$</span>
                  <code className="font-mono text-xs text-green-300 flex-1 break-all">{c.cmd}</code>
                  <CopyButton text={c.cmd} />
                </div>
                <p className="text-xs text-gray-500 pl-2 leading-relaxed border-l-2 border-gray-700">
                  {c.watch}
                </p>
              </div>
            ))}
          </div>
        </>
      )}

      {/* Phase 2: Learned — explanation + production context */}
      {!isWatching && (
        <div className="space-y-4">
          <div>
            <p className="text-xs font-bold text-gray-400 uppercase tracking-wide mb-1.5">What happened</p>
            <p className="text-sm text-gray-200 leading-relaxed">{content.learned}</p>
          </div>
          <div className="bg-black/30 rounded-lg p-3 border border-gray-700/50">
            <p className="text-xs font-bold text-gray-400 uppercase tracking-wide mb-1.5 flex items-center gap-1">
              <ArrowRight className="w-3 h-3" /> In production, this means
            </p>
            <p className="text-sm text-gray-300 leading-relaxed">{content.production}</p>
          </div>
          <div className="flex items-center gap-2 pt-1">
            <p className="text-xs text-gray-600">Verify it yourself:</p>
            {content.commands.slice(0, 1).map((c) => (
              <div key={c.cmd} className="flex items-center gap-2 bg-black/40 rounded px-2 py-1 flex-1">
                <code className="font-mono text-xs text-green-400 truncate flex-1">{c.cmd}</code>
                <CopyButton text={c.cmd} />
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
};

export default SimFlashcard;

