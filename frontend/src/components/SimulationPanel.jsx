/**
 * SimulationPanel — Guided sequential failure simulation list
 *
 * Every action calls the real Kubernetes API. The UI guides the user
 * through a numbered sequence, expands the active sim, and explains
 * what happened after each one completes.
 */

import { useState, useEffect, useCallback, useRef } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import {
  Trash2, ServerOff, Cpu, HardDrive, Database, Loader2,
  RotateCcw, CheckCircle2, ChevronDown, ChevronUp,
  ArrowRight, Eye, X, Terminal, Copy, Check,
} from 'lucide-react';
import api from '../services/api';
import DeepDive from './DeepDive';

const COMPLETED_KEY = 'kubelab_completed';

// ─── Per-simulation static metadata ──────────────────────────────────────────
const SIM_META = {
  'kill-pod': {
    number: 1, startHere: true,
    icon: Trash2, accent: 'border-red-400 bg-red-50',
    btnColor: 'bg-red-600 hover:bg-red-700',
    objective: 'Self-healing and ReplicaSets',
    description: 'Deletes a running backend pod via the Kubernetes API. The Deployment controller immediately notices and creates a replacement.',
    watch: ['Events Feed: Killing → Scheduled → Started', 'Cluster Map: pod chip flashes, then reappears'],
    learn: {
      explanation: 'The ReplicaSet controller constantly checks that actual pod count matches desired (2). The moment your pod was deleted, it created a replacement. This reconciliation loop runs forever.',
      production: 'Node crashes, OOM kills, and process crashes all trigger the same loop. With replicas > 1 and a readiness probe, your app survives any single pod death with zero downtime.',
    },
    next: 'drain-node',
  },
  'drain-node': {
    number: 2,
    icon: ServerOff, accent: 'border-orange-400 bg-orange-50',
    btnColor: 'bg-orange-600 hover:bg-orange-700',
    objective: 'Node maintenance and pod eviction',
    description: 'Marks a node as unschedulable (cordon) then evicts all non-DaemonSet pods. The scheduler immediately places them on healthy nodes.',
    watch: ['Cluster Map: node gets CORDONED banner, pods move to other nodes', 'Events Feed: Evicted entries appear for each pod'],
    learn: {
      explanation: 'Draining cordons the node so no new pods land there, then evicts pods gracefully. The scheduler replaces them on any node with sufficient capacity.',
      production: 'Every kernel patch, cloud provider maintenance, or node upgrade uses this pattern. Pair it with a PodDisruptionBudget to guarantee minimum availability during the drain.',
    },
    next: 'cpu-stress',
  },
  'cpu-stress': {
    number: 3,
    icon: Cpu, accent: 'border-yellow-400 bg-yellow-50',
    btnColor: 'bg-yellow-600 hover:bg-yellow-700',
    objective: 'CPU limits and throttling on your real backend pod',
    description: 'Burns CPU inside a real backend pod for 60 seconds. That pod\'s CPU limit is 200m — the Linux CFS scheduler will throttle it hard. The pod stays alive but slows down. This is exactly what happens to your app in production when CPU is constrained.',
    watch: ['kubectl top pods: one backend pod pegged at ~200m (the limit)', 'The OTHER backend pod keeps serving requests normally — this is HA in action'],
    learn: {
      explanation: 'The backend pod tried to use 100% of a CPU core but was throttled to 200m (0.2 cores) by the Linux CFS scheduler. The process ran the whole time — it was just paused 80% of the time. No crash, no restart. Just slowness.',
      production: 'High CPU throttle % in Prometheus means your limit is too low — the app runs slow even though the node has headroom. The fix is to raise the CPU limit or profile what\'s causing the spike.',
    },
    next: 'memory-stress',
  },
  'memory-stress': {
    number: 4,
    icon: HardDrive, accent: 'border-red-400 bg-red-50',
    btnColor: 'bg-red-600 hover:bg-red-700',
    objective: 'OOMKill on your real backend pod',
    description: 'Allocates memory inside a real backend pod in 50 MB chunks until it crosses the 256 Mi limit. The Linux kernel sends SIGKILL (exit code 137) with no warning. The pod restarts. The other backend replica keeps serving traffic.',
    watch: ['kubectl get pods -w: one backend pod STATUS → OOMKilled → Running (restarted)', 'kubectl describe pod: "Last State: OOMKilled, Exit Code: 137"'],
    learn: {
      explanation: 'The backend pod crossed its 256 Mi memory ceiling. The kernel did not warn it — it sent SIGKILL instantly. Kubernetes recorded this as OOMKilled, incremented the restart count, and replaced the container. The PVC and other pods were untouched.',
      production: 'OOMKilled + rising restart count = memory leak or limit set too low. The fix is kubectl top pods to see actual usage, then either fix the leak or raise the limit. Never run without memory limits in production.',
    },
    next: 'db-failure',
  },
  'db-failure': {
    number: 5,
    icon: Database, accent: 'border-red-500 bg-red-50',
    btnColor: 'bg-red-700 hover:bg-red-800',
    objective: 'Stateful workloads and data persistence',
    description: 'Scales the Postgres StatefulSet to 0. The database pod terminates but the PersistentVolumeClaim (and all data) is preserved.',
    watch: ['Cluster Map: postgres-0 disappears from its node', 'Events Feed: Killing for postgres-0'],
    learn: {
      explanation: 'Scaling to 0 terminates the pod but leaves the PVC intact. Your data survives on the underlying storage. Restoring scales to 1 and Postgres reattaches the same volume automatically.',
      production: 'Scale-to-zero is used for emergency stops, pre-migration locks, and backup windows. Apps must handle connection failure with retries — a DB crash looks identical from the app\'s perspective.',
    },
    next: 'kill-all-pods',
  },
  'kill-all-pods': {
    number: 6,
    icon: Trash2, accent: 'border-rose-500 bg-rose-50',
    btnColor: 'bg-rose-700 hover:bg-rose-800',
    objective: 'Downtime despite replicas — why replicas: 2 is not enough',
    description: 'Deletes BOTH backend pods simultaneously. With replicas: 2, killing one leaves a healthy replica serving traffic. Killing both causes 5–15 seconds of real downtime — zero endpoints, requests fail. Kubernetes creates replacements immediately, but there is a gap.',
    watch: ['kubectl get pods -n kubelab -w: both pods Terminating at the same time', 'kubectl get endpoints -n kubelab backend-service: ENDPOINTS goes empty, then refills'],
    learn: {
      explanation: 'Two replicas protect against one pod dying at a time. They don\'t protect against both dying simultaneously — which happens during a bad deployment rollout, a cluster-wide eviction, or a node running both replicas failing. PodDisruptionBudgets and pod anti-affinity are the actual protection.',
      production: 'The fix: pod anti-affinity (spread replicas across nodes) + PodDisruptionBudget (guarantee ≥1 replica during voluntary disruptions). replicas: 2 is necessary but not sufficient.',
    },
    next: 'fail-readiness',
  },
  'fail-readiness': {
    number: 7,
    icon: Eye, accent: 'border-purple-400 bg-purple-50',
    btnColor: 'bg-purple-600 hover:bg-purple-700',
    objective: 'Silent degradation — Running pod receiving zero traffic',
    description: 'Makes one backend pod fail its readiness probe for 120 seconds. The pod stays Running — kubectl get pods shows Running, liveness passes, no restarts. But Kubernetes removes it from Service endpoints. The other pod handles all traffic. This is the most misunderstood Kubernetes behavior.',
    watch: ['kubectl get pods -n kubelab: STATUS is Running (pod alive, not crashing)', 'kubectl get endpoints -n kubelab backend-service: only 1 IP (this pod removed)', 'kubectl describe pod <this-pod>: Ready=False but ContainersReady=True'],
    learn: {
      explanation: 'Liveness and readiness are separate concepts. Liveness = is the process alive? (fail → restart). Readiness = is it ready to serve traffic? (fail → removed from endpoints, no restart). A pod can be Running but receiving zero requests if its readiness probe fails.',
      production: 'This is how you take a pod out of rotation without killing it — for blue/green deployments, graceful draining, or maintenance. It\'s also how misconfigured probes cause silent partial outages: the pod looks healthy in dashboards but isn\'t serving.',
    },
    next: null,
  },
};

// ─── Knowledge-check quiz (one question per sim) ─────────────────────────────
const QUIZ = {
  'kill-pod': {
    q: 'Why did Kubernetes create a pod with a NEW name instead of restarting the old one?',
    options: [
      'To avoid DNS naming conflicts between pods',
      'Pods are immutable — the ReplicaSet creates a replacement, it never restarts the original',
      'The scheduler deleted the old pod\'s ID from memory',
      'Kubernetes always rotates pod names for security reasons',
    ],
    correct: 1,
    explanation: 'Pods are immutable objects. Once created, their spec never changes. When deleted, they\'re gone permanently. The ReplicaSet controller\'s job is to create a new pod — which is why every replacement has a random suffix.',
  },
  'drain-node': {
    q: 'If you drain a node without a PodDisruptionBudget, what is the worst-case scenario?',
    options: [
      'The node would reject the drain command with an error',
      'Both backend replicas could be on the same node and evicted at once — zero replicas, brief downtime',
      'The database would lose all its data permanently',
      'The drain would take twice as long to complete',
    ],
    correct: 1,
    explanation: 'Without pod anti-affinity + PDB, the scheduler may place both replicas on the same node (it saw capacity there). A single drain evicts both simultaneously. Your replicas: 2 provides zero protection in that case.',
  },
  'cpu-stress': {
    q: 'CPU usage was pinned at the limit for 60 seconds, but the pod never restarted. Why?',
    options: [
      'Kubernetes automatically increased the CPU limit to compensate',
      'CPU limits cause throttling (slowness), not crashes — only memory limits cause OOMKills',
      'The readiness probe detected the spike and prevented a restart',
      'The CPU limit was not actually enforced — it\'s just a soft suggestion',
    ],
    correct: 1,
    explanation: 'CPU limits and memory limits behave completely differently. CPU limits throttle: the kernel pauses the process to enforce the quota — it slows down but keeps running. Memory limits OOMKill: the kernel sends SIGKILL and the process dies instantly. This asymmetry trips up almost everyone.',
  },
  'memory-stress': {
    q: 'The pod\'s exit code was 137. What does this mean, and who sent the signal?',
    options: [
      'Exit 137 = application bug, caught and reported by Kubernetes',
      'Exit 137 = 128 + 9 (SIGKILL), sent by the Linux kernel OOM killer — Kubernetes only observed it',
      'Exit 137 = timeout error, sent by the kubelet after the grace period',
      'Exit 137 = network failure, sent by the kube-proxy on the node',
    ],
    correct: 1,
    explanation: 'Exit code 137 = 128 + signal 9 (SIGKILL). The Linux kernel\'s OOM killer sent SIGKILL directly to the process — not Kubernetes. Kubernetes only observed the exit code and labeled it OOMKilled. This is why there\'s no graceful shutdown: SIGKILL cannot be caught, blocked, or handled.',
  },
  'db-failure': {
    q: 'The postgres-0 pod was completely deleted. Why was all the data still there when it came back?',
    options: [
      'Kubernetes automatically backed up the data before deleting the pod',
      'The PersistentVolumeClaim (PVC) exists independently of the pod — data lives on the volume, not in the container',
      'PostgreSQL replicated its data to another pod during the shutdown',
      'The pod wasn\'t really deleted — it was just temporarily paused by the scheduler',
    ],
    correct: 1,
    explanation: 'Pods are ephemeral — their local filesystem is destroyed on deletion. PersistentVolumeClaims are separate Kubernetes objects that outlive pods. The StatefulSet guarantees postgres-0 always gets the PVC named postgres-data-postgres-0. This is the fundamental difference between StatefulSets and Deployments.',
  },
  'kill-all-pods': {
    q: 'You have replicas: 2. Both pods died simultaneously. Was there downtime?',
    options: [
      'No — Kubernetes routes traffic to the node itself while pods restart',
      'No — the Service keeps a buffer of recent responses',
      'Yes — both pods died simultaneously, endpoints went empty, requests failed until replacements were ready',
      'No — the readiness probe prevents traffic from stopping during restart',
    ],
    correct: 2,
    explanation: 'replicas: 2 protects against one pod dying at a time. When both die simultaneously, the Service has zero endpoints — requests fail immediately. There is no buffering. The protection is pod anti-affinity (spread across nodes) + PodDisruptionBudget (block evictions that would leave zero replicas).',
  },
  'fail-readiness': {
    q: 'The pod showed STATUS: Running and had 0 restarts. But it received no traffic. How?',
    options: [
      'The liveness probe killed the pod and restarted it so fast we didn\'t notice',
      'The readiness probe failed — Kubernetes removed the pod from Service endpoints without restarting it',
      'The CPU limit throttled the pod so heavily it couldn\'t respond to requests',
      'NetworkPolicy blocked traffic to this specific pod\'s IP',
    ],
    correct: 1,
    explanation: 'Liveness and readiness are separate. Liveness failure → restart. Readiness failure → removed from endpoints, zero traffic, no restart. The pod stayed Running and passed liveness, but failed readiness. This is intentional: it\'s how you gracefully drain a pod without killing it.',
  },
};

// ─── "Try This" variants — hands-on follow-up commands ───────────────────────
const VARIANTS = {
  'kill-pod': {
    title: 'Kill ALL backend pods simultaneously',
    cmd: 'kubectl delete pods -n kubelab -l app=backend',
    what: 'With replicas: 2, both die at once. Does the app stay up? Watch the RESTARTS column. You\'ll see a brief gap — 2 replicas don\'t guarantee zero downtime if they\'re killed simultaneously.',
  },
  'drain-node': {
    title: 'Check if your replicas share a node (a hidden HA gap)',
    cmd: 'kubectl get pods -n kubelab -o wide | grep backend',
    what: 'Look at the NODE column. If both backend pods show the SAME node — you just discovered you\'re one drain away from complete downtime. Pod anti-affinity prevents this.',
  },
  'cpu-stress': {
    title: 'Confirm CPU throttling is invisible to kubectl top',
    cmd: 'kubectl top pods -n kubelab',
    what: 'You\'ll see one backend pod at ~200m CPU. Looks normal, right? But the pod was trying to use 2000m and was frozen 90% of the time. kubectl top shows usage at the ceiling — not what was denied.',
  },
  'memory-stress': {
    title: 'Find the OOMKill evidence in the pod description',
    cmd: 'kubectl describe pod -n kubelab -l app=backend | grep -A 8 "Last State"',
    what: 'Look for: Reason: OOMKilled, Exit Code: 137. This forensic trace persists until the pod is replaced. In production, this is how you confirm an OOMKill hours after it happened.',
  },
  'db-failure': {
    title: 'Verify the PVC stayed Bound while the pod was gone',
    cmd: 'kubectl get pvc -n kubelab',
    what: 'Even right now (after restore), postgres-data-postgres-0 shows STATUS: Bound. It was Bound the entire time — even when postgres-0 didn\'t exist. Your data was on the volume, not in the container.',
  },
  'kill-all-pods': {
    title: 'Watch endpoints go empty then refill',
    cmd: 'kubectl get endpoints -n kubelab backend-service -w',
    what: 'You\'ll see ENDPOINTS: <none> for 5–15 seconds, then two new IPs appear. That gap = real downtime. This is what happens during a bad deployment that crashes all pods.',
  },
  'fail-readiness': {
    title: 'Confirm the pod is Running but has no traffic',
    cmd: 'kubectl describe pod -n kubelab <failing-pod> | grep -A 5 Conditions',
    what: 'You\'ll see: Ready: False, ContainersReady: True. The container is running, liveness passes, but readiness fails. Cross-reference with endpoints — this pod\'s IP is missing.',
  },
};

// ─── "What Would Break This?" — thought prompts (no answers provided) ─────────
const BREAKERS = {
  'kill-pod': [
    'What if you only had replicas: 1 — is there any downtime during the kill?',
    'What if the readiness probe was missing? Would the new pod receive traffic before it\'s ready to handle it?',
    'What if terminationGracePeriodSeconds was 0? What happens to HTTP requests mid-flight when the pod dies?',
  ],
  'drain-node': [
    'What if both backend replicas were on the same node when you drained it?',
    'What if the postgres PVC used local (hostPath) storage instead of network storage?',
    'What if you tried to drain both worker nodes at the same time?',
  ],
  'cpu-stress': [
    'What if there were no CPU limits at all — what happens to other pods on the same node?',
    'What if the CPU limit was 10m (very low) — would the pod crash or just be extremely slow?',
    'What if your app had a slow CPU leak — how would you notice it before users do?',
  ],
  'memory-stress': [
    'What if memory limits weren\'t set at all — what would happen to the node?',
    'What if the app had a slow memory leak over 8 hours — would anyone notice before it crashed?',
    'What if you set memory limits lower than memory requests — would Kubernetes allow it?',
  ],
  'db-failure': [
    'What if the backend application didn\'t retry database connections after Postgres came back?',
    'What if the PVC used local storage and the node it lives on also got drained?',
    'What if you had 3 Postgres replicas with streaming replication — would this simulation cause data loss?',
  ],
  'kill-all-pods': [
    'What if a bad deployment rollout crashed all new pods before rolling back — how long would downtime last?',
    'What if you had 5 replicas but no pod anti-affinity — could all 5 end up on the same node?',
    'What if you had a PodDisruptionBudget with minAvailable: 1 — would kubectl delete pods -l app=backend work?',
  ],
  'fail-readiness': [
    'What if the readiness probe was the same as the liveness probe — when would that cause problems?',
    'What if ALL backend pods failed their readiness probes simultaneously — what would users experience?',
    'What if the readiness probe checked a dependency (like the database) — what happens when the database goes down?',
  ],
};

// ─── Pre-flight cluster status check ──────────────────────────────────────────
const PRE_FLIGHT = {
  'kill-pod': (status) => {
    const running = (status?.data?.pods || []).filter(p => p.name?.startsWith('backend') && p.status === 'Running').length;
    if (running < 2) return { ok: false, msg: `Only ${running}/2 backend pods Running — killing one leaves 0 replicas` };
    return { ok: true, msg: `${running} backend pods Running — one kill leaves 1 healthy replica` };
  },
  'drain-node': (status) => {
    const workers = (status?.data?.nodes || []).filter(n => n.role === 'worker' && !n.unschedulable).length;
    if (workers < 2) return { ok: false, msg: `Only ${workers} schedulable worker — evicted pods may stay Pending` };
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

// ─── Per-simulation terminal workflow ────────────────────────────────────────
// before: run this and leave it streaming BEFORE clicking the button
//         → learner sees the live output the moment Kubernetes reacts
// after:  run this once the simulation is done to inspect what happened
const TERMINAL_CMDS = {
  'kill-pod': {
    before: {
      cmd: 'kubectl get events -n kubelab -w',
      why: 'Streams every event the control plane fires. You will see: Killing → SuccessfulCreate → Scheduled → Pulled → Started — the full self-healing sequence in real time.',
    },
    also: {
      cmd: 'kubectl get pods -n kubelab -w',
      why: 'Open a second tab. Watch the dead pod disappear and a brand-new one spin up.',
    },
    after: {
      cmd: 'kubectl describe replicaset -n kubelab | grep -A 5 "Events:"',
      why: 'Shows the exact ReplicaSet event: "SuccessfulCreate — Created pod backend-xxxx"',
    },
  },
  'drain-node': {
    before: {
      cmd: 'kubectl get events -n kubelab -w',
      why: 'You will see eviction events for each pod as the drain progresses.',
    },
    also: {
      cmd: 'kubectl get nodes -w',
      why: 'Watch the drained node STATUS change to SchedulingDisabled.',
    },
    after: {
      cmd: 'kubectl get pods -n kubelab -o wide',
      why: 'Check the NODE column — all pods should now be on the remaining nodes.',
    },
  },
  'cpu-stress': {
    before: {
      cmd: 'watch -n 5 kubectl top pods -n kubelab',
      why: 'Leave this running — it refreshes every 5 seconds. After clicking, one backend pod will jump to ~200m CPU (the limit). The other backend pod stays at idle. This is the throttle in action.',
    },
    also: {
      cmd: 'kubectl get pods -n kubelab',
      why: 'Second tab. The backend pod stays Running the entire 60 seconds. CPU throttling does NOT restart the pod — only OOMKill does. This is a key distinction.',
    },
    after: {
      cmd: 'kubectl logs -n kubelab -l app=backend -f',
      why: 'You will see "CPU stress running… complete" entries from the pod that handled the request. The other backend pod\'s logs are silent — it was never involved.',
    },
  },
  'memory-stress': {
    before: {
      cmd: 'kubectl get pods -n kubelab -w',
      why: 'Leave this running. Watch the RESTARTS column on a backend pod — it will increment when the OOMKill happens. The other backend pod stays at 0 restarts.',
    },
    also: {
      cmd: 'kubectl get events -n kubelab -w',
      why: 'Second tab. Watch for the OOMKilling event on a backend pod — not a separate stress pod. This is your actual application pod dying.',
    },
    after: {
      cmd: 'kubectl describe pod -n kubelab -l app=backend',
      why: 'Look under "Last State" for the killed pod. You will see: Reason: OOMKilled, Exit Code: 137. That\'s 128 + signal 9 (SIGKILL from the kernel).',
    },
  },
  'db-failure': {
    before: {
      cmd: 'kubectl get events -n kubelab -w',
      why: 'Watch the Postgres pod receive a Killing event. StatefulSets do not auto-replace when scaled to 0.',
    },
    also: {
      cmd: 'kubectl get pods -n kubelab -w',
      why: 'Watch postgres-0 terminate. Unlike a Deployment pod, it will NOT be recreated.',
    },
    after: {
      cmd: 'kubectl get pvc -n kubelab',
      why: 'The PVC stays Bound even with 0 pods running. Your data is safe on the volume.',
    },
  },
  'kill-all-pods': {
    before: {
      cmd: 'kubectl get endpoints -n kubelab backend-service -w',
      why: 'This is where the downtime becomes visible. When both pods die, ENDPOINTS goes to <none>. Every request during that gap fails. Watch it refill when the new pods pass their readiness probes.',
    },
    also: {
      cmd: 'kubectl get pods -n kubelab -w',
      why: 'Watch both backend pods Terminating at the same time — unlike the single kill, there is no surviving replica. The RESTARTS column will both show 0 on the new pods (fresh containers).',
    },
    after: {
      cmd: 'kubectl get events -n kubelab --sort-by=.lastTimestamp | tail -15',
      why: 'You\'ll see two SuccessfulDelete events firing at the same time, followed by two SuccessfulCreate events. The gap between them is your downtime window.',
    },
  },
  'fail-readiness': {
    before: {
      cmd: 'kubectl get endpoints -n kubelab backend-service -w',
      why: 'Leave this running. When the readiness probe fails on one pod, its IP disappears from endpoints. The other pod\'s IP stays. This is the clearest signal that readiness != liveness.',
    },
    also: {
      cmd: 'kubectl get pods -n kubelab',
      why: 'Check this AFTER clicking — the failing pod shows STATUS: Running with 0 restarts. It is not crashing. It is alive and failing its readiness probe intentionally.',
    },
    after: {
      cmd: 'kubectl describe pod -n kubelab -l app=backend | grep -A 10 "Conditions:"',
      why: 'Look for: Ready: False, ContainersReady: True. This is the key evidence — the container is healthy but the pod is not ready for traffic. These two conditions are independent.',
    },
  },
};

// ─── CopyBtn ──────────────────────────────────────────────────────────────────
const CopyBtn = ({ text }) => {
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
      title="Copy to clipboard"
      className="flex-shrink-0 flex items-center gap-1 text-xs px-1.5 py-0.5 rounded border border-gray-700 text-gray-500 hover:text-gray-200 hover:border-gray-500 transition-colors"
    >
      {copied ? <Check className="w-3 h-3 text-green-400" /> : <Copy className="w-3 h-3" />}
      <span className="font-mono">{copied ? 'Copied' : 'Copy'}</span>
    </button>
  );
};

// ─── TerminalGuide ────────────────────────────────────────────────────────────
// Shown inside every expanded sim card, ABOVE the action button.
// Teaches the 3-step rhythm: watch → trigger → verify.
const TerminalGuide = ({ simId }) => {
  const t = TERMINAL_CMDS[simId];
  if (!t) return null;

  const Step = ({ num, label, labelColor, cmd, why }) => (
    <div className="px-3 py-3">
      <div className="flex items-center gap-2 mb-2">
        <span className={`text-xs font-bold font-mono ${labelColor}`}>
          Step {num} — {label}
        </span>
      </div>
      <div className="flex items-center gap-2 bg-black/60 rounded px-3 py-2">
        <span className="text-green-500 font-mono text-xs select-none flex-shrink-0">$</span>
        <code className="font-mono text-xs text-green-300 flex-1 break-all">{cmd}</code>
        <CopyBtn text={cmd} />
      </div>
      <p className="text-xs text-gray-500 mt-1.5 pl-1 leading-relaxed">{why}</p>
    </div>
  );

  return (
    <div className="mt-3 rounded-lg overflow-hidden border border-gray-700 bg-gray-950">
      {/* Header */}
      <div className="flex items-center gap-2 px-3 py-2 bg-gray-900 border-b border-gray-700">
        <Terminal className="w-3.5 h-3.5 text-green-400" />
        <span className="text-xs font-semibold text-green-300 font-mono">Your terminal</span>
        <span className="text-xs text-gray-500 font-mono">— the UI is a visual aid; this is where you really learn</span>
      </div>

      <div className="divide-y divide-gray-800/60">
        {/* Step 1 — primary watch command */}
        <Step
          num={1}
          label="Run this now and leave it open"
          labelColor="text-yellow-400"
          cmd={t.before.cmd}
          why={t.before.why}
        />

        {/* Step 2 — optional second tab */}
        {t.also && (
          <div className="px-3 py-2 bg-gray-900/30">
            <p className="text-xs text-gray-500 mb-1.5 font-mono">Optional — open a second terminal tab:</p>
            <div className="flex items-center gap-2 bg-black/40 rounded px-3 py-1.5">
              <span className="text-green-600 font-mono text-xs select-none flex-shrink-0">$</span>
              <code className="font-mono text-xs text-gray-400 flex-1 break-all">{t.also.cmd}</code>
              <CopyBtn text={t.also.cmd} />
            </div>
            <p className="text-xs text-gray-600 mt-1 pl-1">{t.also.why}</p>
          </div>
        )}

        {/* Divider with instruction */}
        <div className="px-3 py-2 bg-gray-900/50 flex items-center gap-2">
          <div className="flex-1 h-px bg-gray-700" />
          <span className="text-xs text-gray-400 font-mono flex-shrink-0">then click the button below ↓</span>
          <div className="flex-1 h-px bg-gray-700" />
        </div>

        {/* Step 3 — verify after */}
        <Step
          num={3}
          label="After completion — verify"
          labelColor="text-blue-400"
          cmd={t.after.cmd}
          why={t.after.why}
        />
      </div>
    </div>
  );
};

// ─── WatchCallout ─────────────────────────────────────────────────────────────
const WatchCallout = ({ items }) => (
  <div className="mt-3 bg-blue-50 border border-blue-200 rounded-lg p-3">
    <p className="text-xs font-semibold text-blue-700 flex items-center gap-1 mb-1.5">
      <Eye className="w-3.5 h-3.5" /> Watch now
    </p>
    <ul className="space-y-1">
      {items.map((item, i) => (
        <li key={i} className="text-xs text-blue-700 flex items-start gap-1.5">
          <span className="mt-0.5 text-blue-400">›</span> {item}
        </li>
      ))}
    </ul>
  </div>
);

// ─── WhatYouLearned ───────────────────────────────────────────────────────────
const WhatYouLearned = ({ simId, meta, onNext, onDismiss }) => {
  const quiz    = QUIZ[simId];
  const variant = VARIANTS[simId];
  const breakers = BREAKERS[simId];

  const [selected,     setSelected]     = useState(null);
  const [copiedVariant, setCopiedVariant] = useState(false);
  const [breakersOpen, setBreakersOpen] = useState(false);

  const answered  = selected !== null;
  const isCorrect = selected === quiz?.correct;
  const canNext   = !quiz || isCorrect;

  const handleVariantCopy = () => {
    if (!variant) return;
    navigator.clipboard.writeText(variant.cmd).catch(() => {});
    setCopiedVariant(true);
    setTimeout(() => setCopiedVariant(false), 2000);
  };

  return (
    <div className="mt-3 bg-green-50 border border-green-300 rounded-xl p-4 space-y-4">

      {/* ── Header ─────────────────────────────────────────────────────── */}
      <div className="flex items-start justify-between">
        <p className="text-xs font-bold text-green-800 uppercase tracking-wide">✅ What You Just Learned</p>
      <button onClick={onDismiss} className="text-green-400 hover:text-green-600 transition-colors">
        <X className="w-3.5 h-3.5" />
      </button>
    </div>

      {/* ── Core explanation ────────────────────────────────────────────── */}
      <div>
    <p className="text-sm text-green-900 leading-relaxed mb-3">{meta.learn.explanation}</p>
        <div className="bg-green-100 rounded-md px-3 py-2">
      <p className="text-xs font-semibold text-green-700 mb-1">In production, this means:</p>
      <p className="text-xs text-green-800 leading-relaxed">{meta.learn.production}</p>
    </div>
      </div>

      {/* ── Knowledge check ────────────────────────────────────────────── */}
      {quiz && (
        <div className="border-t border-green-200 pt-4">
          <p className="text-xs font-bold text-gray-700 uppercase tracking-wide mb-2">
            ✏️ Quick check — answer before moving on
          </p>
          <p className="text-sm font-medium text-gray-800 leading-snug mb-3">{quiz.q}</p>
          <div className="space-y-2">
            {quiz.options.map((opt, i) => {
              let cls = 'bg-white border-gray-200 text-gray-700 hover:border-gray-400';
              if (selected === i) {
                cls = i === quiz.correct
                  ? 'bg-green-100 border-green-500 text-green-900 font-medium'
                  : 'bg-red-100 border-red-400 text-red-900';
              } else if (answered && i === quiz.correct) {
                cls = 'bg-green-50 border-green-300 text-green-800';
              }
              return (
                <button
                  key={i}
                  onClick={() => !isCorrect && setSelected(i)}
                  disabled={isCorrect}
                  className={`w-full text-left text-xs px-3 py-2.5 rounded-lg border transition-all ${cls}`}
                >
                  <span className="font-mono text-gray-400 mr-2">{String.fromCharCode(65 + i)}.</span>
                  {opt}
                </button>
              );
            })}
          </div>
          {answered && !isCorrect && (
            <p className="text-xs text-red-600 mt-2 font-medium">Not quite — try again.</p>
          )}
          {isCorrect && (
            <div className="mt-3 bg-green-100 border border-green-300 rounded-lg px-3 py-2">
              <p className="text-xs text-green-800 leading-relaxed">
                <span className="font-bold">Correct! </span>{quiz.explanation}
              </p>
            </div>
          )}
        </div>
      )}

      {/* ── Try This Variant (revealed after correct answer) ─────────── */}
      {canNext && variant && (
        <div className="border-t border-green-200 pt-4">
          <p className="text-xs font-bold text-blue-700 uppercase tracking-wide mb-1.5">🧪 Try This Next</p>
          <p className="text-xs font-semibold text-blue-800 mb-1">{variant.title}</p>
          <div className="flex items-center gap-2 bg-gray-900 rounded-lg px-3 py-2 mb-2">
            <span className="text-green-400 font-mono text-xs select-none">$</span>
            <code className="font-mono text-xs text-green-300 flex-1 break-all">{variant.cmd}</code>
            <button
              onClick={handleVariantCopy}
              className="flex-shrink-0 text-gray-500 hover:text-gray-300 transition-colors"
            >
              {copiedVariant ? <Check className="w-3.5 h-3.5 text-green-400" /> : <Copy className="w-3.5 h-3.5" />}
            </button>
          </div>
          <p className="text-xs text-blue-700 leading-relaxed">{variant.what}</p>
        </div>
      )}

      {/* ── What Would Break This? ──────────────────────────────────────── */}
      {canNext && breakers && (
        <div className="border-t border-green-200 pt-3">
          <button
            onClick={() => setBreakersOpen(p => !p)}
            className="flex items-center gap-1.5 text-xs font-bold text-orange-700 uppercase tracking-wide"
          >
            {breakersOpen ? <ChevronUp className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
            🤔 What Would Break This? (think before expanding)
          </button>
          {breakersOpen && (
            <ul className="mt-2.5 space-y-2">
              {breakers.map((b, i) => (
                <li key={i} className="flex items-start gap-2 text-xs text-orange-800 leading-relaxed">
                  <span className="text-orange-400 flex-shrink-0 mt-0.5">›</span>
                  {b}
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

      {/* ── Action buttons ──────────────────────────────────────────────── */}
      <div className="border-t border-green-200 pt-3 flex items-center gap-2 flex-wrap">
      <button
        onClick={onDismiss}
        className="text-xs px-3 py-1.5 rounded-lg border border-green-300 text-green-700 hover:bg-green-100 transition-colors"
      >
        Got it
      </button>
        {meta.next && SIM_META[meta.next] && canNext && (
        <button
          onClick={() => onNext(meta.next)}
          className="flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-lg bg-green-600 hover:bg-green-700 text-white font-semibold transition-colors"
        >
          Next: {SIM_META[meta.next].objective} <ArrowRight className="w-3 h-3" />
        </button>
      )}
        {quiz && !isCorrect && (
          <span className="text-xs text-gray-400 italic">Answer the question above to unlock Next →</span>
        )}
    </div>
  </div>
);
};

// ─── SimCard ──────────────────────────────────────────────────────────────────
const SimCard = ({
  simId, isExpanded, isCompleted, isActive, isDimmed,
  label, isLoading, children, onToggle,
}) => {
  const meta = SIM_META[simId];
  const Icon = meta.icon;

  return (
    <div
      id={`sim-${simId}`}
      className={`
        rounded-xl border-2 transition-all duration-300
        ${isExpanded ? meta.accent : 'border-gray-200 bg-white'}
        ${isDimmed ? 'opacity-50' : 'opacity-100'}
      `}
    >
      {/* Row header */}
      <button
        className="w-full flex items-center gap-3 p-4 text-left"
        onClick={onToggle}
      >
        {/* Number badge */}
        <span className={`
          w-7 h-7 rounded-full flex items-center justify-center text-xs font-bold flex-shrink-0
          ${isCompleted ? 'bg-green-500 text-white' : isExpanded ? 'bg-blue-600 text-white' : 'bg-gray-100 text-gray-500'}
        `}>
          {isCompleted ? <CheckCircle2 className="w-4 h-4" /> : meta.number}
        </span>

        {/* Title + objective */}
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="font-semibold text-sm text-gray-900">{label}</span>
            {meta.startHere && !isCompleted && (
              <span className="text-xs px-2 py-0.5 rounded-full bg-blue-100 text-blue-700 font-semibold">
                Start here →
              </span>
            )}
            {isActive && (
              <span className="text-xs px-2 py-0.5 rounded-full bg-yellow-100 text-yellow-700 font-semibold animate-pulse">
                Running…
              </span>
            )}
          </div>
          <p className="text-xs text-gray-500 mt-0.5">
            <span className="font-medium text-gray-400">Learn:</span> {meta.objective}
          </p>
        </div>

        {/* Icon + chevron */}
        <div className="flex items-center gap-2 flex-shrink-0">
          {isLoading
            ? <Loader2 className="w-4 h-4 text-gray-400 animate-spin" />
            : <Icon className="w-4 h-4 text-gray-400" />
          }
          {isExpanded
            ? <ChevronUp className="w-4 h-4 text-gray-400" />
            : <ChevronDown className="w-4 h-4 text-gray-400" />
          }
        </div>
      </button>

      {/* Expanded body */}
      {isExpanded && (
        <div className="px-4 pb-4 border-t border-gray-100 pt-3">
          {children}
        </div>
      )}
    </div>
  );
};

// ─── SimulationPanel ──────────────────────────────────────────────────────────
const SimulationPanel = ({ onActivity, onSimStart, onSimComplete, mockMode = false }) => {
  const queryClient = useQueryClient();
  const [confirmDialog, setConfirmDialog] = useState(null);
  const [selectedNode, setSelectedNode]   = useState('');

  // Derive available worker nodes from the already-cached cluster status
  // (no extra API call — React Query shares the cache with ClusterMap / ClusterOverview)
  const cachedStatus = queryClient.getQueryData(['clusterStatus']);
  const workerNodes  = (cachedStatus?.data?.nodes || [])
    .filter(n => n.role === 'worker' && n.status === 'True' && !n.unschedulable)
    .map(n => n.name);

  // ── Simulation timing state (declared before mutations that use them) ──────
  const [cpuCountdown, setCpuCountdown]       = useState(0);
  const [memoryCountdown, setMemoryCountdown] = useState(0);
  const drainToastRef = useRef(null);

  const [drainedNode, setDrainedNode]         = useState(null);
  const [dbDown, setDbDown]                   = useState(false);
  const [readinessCountdown, setReadinessCountdown] = useState(0);
  const [expandedSim, setExpandedSim]     = useState('kill-pod'); // open by default
  const [learnedSim, setLearnedSim]       = useState(null);
  const [completed, setCompleted]         = useState(() => {
    try { return new Set(JSON.parse(localStorage.getItem(COMPLETED_KEY) || '[]')); }
    catch { return new Set(); }
  });

  const markCompleted = useCallback((simId) => {
    setCompleted(prev => {
      const next = new Set(prev);
      next.add(simId);
      localStorage.setItem(COMPLETED_KEY, JSON.stringify([...next]));
      return next;
    });
  }, []);

  // Listen for kill shortcut from App.jsx keyboard handler
  useEffect(() => {
    const handle = () => killPodMutation.mutate();
    window.addEventListener('killPodShortcut', handle);
    return () => window.removeEventListener('killPodShortcut', handle);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

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
      setLearnedSim('kill-pod');
      setExpandedSim('kill-pod');
      log('Kill Pod', `${pod} deleted`, true, {
        emoji: '🔴', explanation: 'The ReplicaSet controller creates a replacement within seconds.',
      });
      onSimComplete?.('kill-pod', true);
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
      // Don't call onSimComplete yet — keep SimFlashcard in "watching" phase
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
    mutationFn: () => api.post('/simulate/memory-stress', {}),
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
      // Keep SimFlashcard in "watching" phase while the OOMKill window is open
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
      setLearnedSim('db-failure');
      setExpandedSim('db-failure');
      log('DB Failure', 'postgres → 0 replicas', true, {
        emoji: '🔴', explanation: 'Postgres pod terminated. PVC data is safe.',
      });
      onSimComplete?.('db-failure', true);
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
        description: 'Watch: kubectl get endpoints -n kubelab backend-service — ENDPOINTS goes empty then refills',
      });
      markCompleted('kill-all-pods');
      setLearnedSim('kill-all-pods');
      setExpandedSim('kill-all-pods');
      log('Kill All Pods', `${killed.length} pods killed simultaneously`, true, {
        emoji: '🔴', explanation: 'Both replicas dead — Service endpoints went empty. Kubernetes is recreating them.',
      });
      onSimComplete?.('kill-all-pods', true);
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
        description: 'STATUS stays Running — but check endpoints: kubectl get endpoints -n kubelab backend-service',
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
        description: 'Pod will rejoin endpoints within 5–10 seconds. Watch: kubectl get endpoints -n kubelab backend-service',
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

  // ── Pre-flight status bar ─────────────────────────────────────────────────
  const PreflightCheck = ({ simId }) => {
    const checkFn = PRE_FLIGHT[simId];
    if (!checkFn) return null;
    const result = checkFn(cachedStatus);
    return (
      <div className={`flex items-center gap-2 text-xs px-3 py-1.5 rounded-lg mb-3 border ${
        result.ok
          ? 'bg-green-50 border-green-200 text-green-700'
          : 'bg-yellow-50 border-yellow-300 text-yellow-800'
      }`}>
        <span>{result.ok ? '✅' : '⚠️'}</span>
        <span className="font-medium">{result.msg}</span>
      </div>
    );
  };

  // ── Per-sim action trigger + button ───────────────────────────────────────
  const renderSimBody = (simId) => {
    const meta = SIM_META[simId];

    // Drain node is special — has restore state
    if (simId === 'drain-node') {
      return (
        <>
          <PreflightCheck simId={simId} />
          <p className="text-sm text-gray-600 leading-relaxed mb-3">{meta.description}</p>
          <TerminalGuide simId={simId} />
          <WatchCallout items={meta.watch} />
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
                disabled={drainNodeMutation.isPending}
                className={`flex items-center gap-2 px-4 py-2 text-sm font-semibold rounded-lg text-white disabled:opacity-50 transition-colors ${meta.btnColor}`}
              >
                {drainNodeMutation.isPending && <Loader2 className="w-4 h-4 animate-spin" />}
                Drain Worker Node
              </button>
            )}
          </div>
          <DeepDive simId={simId} />
          {learnedSim === simId && <WhatYouLearned simId={simId} meta={meta} onDismiss={() => setLearnedSim(null)} onNext={(id) => { setLearnedSim(null); setExpandedSim(id); }} />}
        </>
      );
    }

    // DB failure is special — has restore state
    if (simId === 'db-failure') {
      return (
        <>
          <PreflightCheck simId={simId} />
          <p className="text-sm text-gray-600 leading-relaxed mb-3">{meta.description}</p>
          <TerminalGuide simId={simId} />
          <WatchCallout items={meta.watch} />
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
                disabled={dbFailureMutation.isPending}
                className={`flex items-center gap-2 px-4 py-2 text-sm font-semibold rounded-lg text-white disabled:opacity-50 transition-colors ${meta.btnColor}`}
              >
                {dbFailureMutation.isPending && <Loader2 className="w-4 h-4 animate-spin" />}
                Simulate DB Failure
              </button>
            )}
          </div>
          <DeepDive simId={simId} />
          {learnedSim === simId && <WhatYouLearned simId={simId} meta={meta} onDismiss={() => setLearnedSim(null)} onNext={(id) => { setLearnedSim(null); setExpandedSim(id); }} />}
        </>
      );
    }

    // Kill all pods — cascading failure with real downtime
    if (simId === 'kill-all-pods') {
      return (
        <>
          <PreflightCheck simId={simId} />
          <p className="text-sm text-gray-600 leading-relaxed mb-3">{meta.description}</p>
          <TerminalGuide simId={simId} />
          <WatchCallout items={meta.watch} />
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
              disabled={killAllPodsMutation.isPending}
              className={`flex items-center gap-2 px-4 py-2 text-sm font-semibold rounded-lg text-white disabled:opacity-50 transition-colors ${meta.btnColor}`}
            >
              {killAllPodsMutation.isPending && <Loader2 className="w-4 h-4 animate-spin" />}
              Kill All Backend Pods
            </button>
          </div>
          <DeepDive simId={simId} />
          {learnedSim === simId && <WhatYouLearned simId={simId} meta={meta} onDismiss={() => setLearnedSim(null)} onNext={(id) => { setLearnedSim(null); setExpandedSim(id); }} />}
        </>
      );
    }

    // Readiness probe failure — toggle with countdown + restore
    if (simId === 'fail-readiness') {
      const isActive = readinessCountdown > 0;
      return (
        <>
          <PreflightCheck simId={simId} />
          <p className="text-sm text-gray-600 leading-relaxed mb-3">{meta.description}</p>
          <TerminalGuide simId={simId} />
          <WatchCallout items={meta.watch} />
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
                disabled={failReadinessMutation.isPending}
                className={`flex items-center gap-2 px-4 py-2 text-sm font-semibold rounded-lg text-white disabled:opacity-50 transition-colors ${meta.btnColor}`}
              >
                {failReadinessMutation.isPending && <Loader2 className="w-4 h-4 animate-spin" />}
                Fail Readiness Probe (120s)
              </button>
            )}
          </div>
          <DeepDive simId={simId} />
          {learnedSim === simId && <WhatYouLearned simId={simId} meta={meta} onDismiss={() => setLearnedSim(null)} onNext={(id) => { setLearnedSim(null); setExpandedSim(id); }} />}
        </>
      );
    }

    // Generic sims
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
        <PreflightCheck simId={simId} />
        <p className="text-sm text-gray-600 leading-relaxed mb-3">{meta.description}</p>
        <TerminalGuide simId={simId} />
        <WatchCallout items={meta.watch} />
        <div className="mt-3 flex items-center gap-3 flex-wrap">
          <button
            onClick={handleClick}
            disabled={entry.mutation.isPending || isCpuActive || isMemoryActive}
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
        <DeepDive simId={simId} />
        {learnedSim === simId && <WhatYouLearned simId={simId} meta={meta} onDismiss={() => setLearnedSim(null)} onNext={(id) => { setLearnedSim(null); setExpandedSim(id); }} />}
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

  const simIds = Object.keys(SIM_META);
  const completedCount = simIds.filter(id => completed.has(id)).length;
  const remainingCount = simIds.length - completedCount;
  // ~15 min per sim, ~5 min for first orientation
  const estMinutes = remainingCount * 15;

  return (
    <>
      <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-6">
        {/* Header */}
        <div className="flex items-center justify-between mb-5">
          <div>
            <h2 className="text-lg font-bold text-gray-900">Failure Simulations</h2>
            <p className="text-xs text-gray-400 mt-0.5">
              {mockMode ? '⚠ Mock mode — connect a real cluster to run these' : 'Real Kubernetes API — nothing mocked'}
            </p>
          </div>
          <div className="flex items-center gap-3">
            {/* Progress */}
            <div className="flex items-center gap-1.5">
              <div className="flex gap-1">
                {simIds.map(id => (
                  <div
                    key={id}
                    className={`w-2 h-2 rounded-full transition-colors ${completed.has(id) ? 'bg-green-500' : 'bg-gray-200'}`}
                  />
                ))}
              </div>
              <span className="text-xs text-gray-500">{completedCount}/{simIds.length}</span>
            </div>
            {remainingCount > 0 && (
              <span className="text-xs text-gray-400 tabular-nums">
                ~{estMinutes}m left
              </span>
            )}
            {remainingCount === 0 && (
              <span className="text-xs text-green-600 font-semibold">All done 🎉</span>
            )}
            <span className="text-xs text-gray-400 bg-gray-100 px-2 py-1 rounded">
              Press <kbd className="px-1 py-0.5 bg-white border border-gray-300 rounded text-xs font-mono">k</kbd> to kill
            </span>
          </div>
        </div>

        {/* ── Active simulations banner ─────────────────────────────────── */}
        {(cpuCountdown > 0 || memoryCountdown > 0 || drainNodeMutation.isPending) && (
          <div className="mb-4 space-y-2">

            {/* CPU stress progress */}
            {cpuCountdown > 0 && (
              <div className="rounded-lg bg-yellow-50 border border-yellow-200 p-3">
                <div className="flex items-center justify-between mb-1.5">
                  <span className="text-xs font-bold text-yellow-800 flex items-center gap-1.5">
                    <span className="inline-block w-2 h-2 rounded-full bg-yellow-500 animate-pulse" />
                    🔥 CPU Stress Running
                  </span>
                  <span className="text-xs font-mono text-yellow-700 font-semibold tabular-nums">{cpuCountdown}s</span>
                </div>
                <div className="h-1.5 bg-yellow-200 rounded-full overflow-hidden">
                  <div
                    className="h-1.5 bg-yellow-500 rounded-full transition-all duration-1000 ease-linear"
                    style={{ width: `${(cpuCountdown / 60) * 100}%` }}
                  />
                </div>
                <p className="text-xs text-yellow-700 mt-2">
                  💡 Run:{' '}
                  <code className="bg-yellow-100 px-1 py-0.5 rounded font-mono">kubectl top pods -n kubelab</code>
                  {' '}— one backend pod should be pegged at 200m (the throttle ceiling)
                </p>
              </div>
            )}

            {/* Memory stress OOMKill countdown */}
            {memoryCountdown > 0 && (
              <div className="rounded-lg bg-red-50 border border-red-200 p-3">
                <div className="flex items-center justify-between mb-1.5">
                  <span className="text-xs font-bold text-red-800 flex items-center gap-1.5">
                    <span className="inline-block w-2 h-2 rounded-full bg-red-500 animate-pulse" />
                    💾 OOMKill window — watch closely
                  </span>
                  <span className="text-xs font-mono text-red-700 font-semibold tabular-nums">~{memoryCountdown}s</span>
                </div>
                <div className="h-1.5 bg-red-200 rounded-full overflow-hidden">
                  <div
                    className="h-1.5 bg-red-500 rounded-full transition-all duration-1000 ease-linear"
                    style={{ width: `${(memoryCountdown / 20) * 100}%` }}
                  />
                </div>
                <p className="text-xs text-red-700 mt-2">
                  💡 Run:{' '}
                  <code className="bg-red-100 px-1 py-0.5 rounded font-mono">kubectl get pods -n kubelab -w</code>
                  {' '}— watch RESTARTS increment on a backend pod when the kernel kills it
                </p>
              </div>
            )}

            {/* Drain node in-flight */}
            {drainNodeMutation.isPending && (
              <div className="rounded-lg bg-orange-50 border border-orange-200 p-3">
                <div className="flex items-center gap-2">
                  <Loader2 className="w-3.5 h-3.5 text-orange-500 animate-spin flex-shrink-0" />
                  <span className="text-xs font-bold text-orange-800">Draining node — evicting pods (30–60s)</span>
                </div>
                <p className="text-xs text-orange-700 mt-2">
                  💡 Run:{' '}
                  <code className="bg-orange-100 px-1 py-0.5 rounded font-mono">kubectl get events -n kubelab -w</code>
                  {' '}— watch Evicted events appear for each pod on the node
                </p>
              </div>
            )}

          </div>
        )}

        {/* Sequential list */}
        <div className={`space-y-2 ${mockMode ? 'opacity-50 pointer-events-none select-none' : ''}`}>
          {simIds.map((simId) => (
            <SimCard
              key={simId}
              simId={simId}
              isExpanded={expandedSim === simId}
              isCompleted={completed.has(simId)}
              isActive={LOADING_MAP[simId]}
              isDimmed={expandedSim !== null && expandedSim !== simId && !LOADING_MAP[simId]}
              label={LABEL_MAP[simId]}
              isLoading={LOADING_MAP[simId]}
              onToggle={() => setExpandedSim(prev => prev === simId ? null : simId)}
            >
              {renderSimBody(simId)}
            </SimCard>
          ))}
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
