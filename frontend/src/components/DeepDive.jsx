/**
 * DeepDive — Control-plane anatomy, kubectl verification, production trap
 *
 * This is the educational core of KubeLab.
 * For each simulation it shows:
 *   1. Anatomy  — what literally happens inside the cluster, step by step
 *   2. Verify   — exact kubectl commands + annotated expected output
 *   3. Trap     — the production incident pattern this failure mode creates
 *   4. Defend   — the mitigation / best practice
 */

import { useState } from 'react';
import { ChevronDown, ChevronUp, Terminal, AlertTriangle, Shield, Layers } from 'lucide-react';

// ─── Deep content per simulation ─────────────────────────────────────────────
export const DEEP_CONTENT = {
  'kill-pod': {
    anatomy: [
      { step: 1, text: 'You call DELETE /api/v1/namespaces/kubelab/pods/<name>. API server sets deletionTimestamp on the pod object in etcd — the pod is NOT yet dead.' },
      { step: 2, text: 'Endpoints controller sees deletionTimestamp → immediately removes the pod from the Service endpoint list. Traffic stops flowing to it before it shuts down.' },
      { step: 3, text: 'Kubelet on the node detects deletionTimestamp → sends SIGTERM to PID 1. The container has terminationGracePeriodSeconds (default: 30s) to shut down cleanly.' },
      { step: 4, text: 'ReplicaSet controller\'s watch fires: actual count (1) ≠ desired count (2). It calls POST /pods to create a replacement — this happens in parallel with shutdown.' },
      { step: 5, text: 'Scheduler evaluates all nodes: available CPU/memory, taints, tolerations, affinity rules. It writes nodeName onto the new pod spec in etcd.' },
      { step: 6, text: 'Kubelet on the selected node pulls the image (likely cached), starts the container, runs the readiness probe. When probe passes, endpoints controller adds the pod back to the Service.' },
    ],
    verify: [
      {
        cmd: 'kubectl get pods -n kubelab -w',
        annotation: 'Watch state transitions in real time. You will see: Running → Terminating (deletionTimestamp set) → a new pod: Pending → ContainerCreating → Running. Total time: 3–10 seconds in a healthy cluster.',
      },
      {
        cmd: 'kubectl describe replicaset -n kubelab -l app=backend | grep -A 3 "Replicas:"',
        annotation: 'The ReplicaSet spec shows desired=2. During the gap, current may read 1. After recovery: "2 current / 2 desired" confirms convergence.',
      },
      {
        cmd: 'kubectl get events -n kubelab --sort-by=.lastTimestamp | tail -15',
        annotation: 'Events tell the full story: Killing (kubelet), SuccessfulCreate (replicaset-controller), Scheduled (scheduler), Pulled/Started (kubelet). Each line is a real control-plane action.',
      },
      {
        cmd: 'kubectl get endpoints -n kubelab backend-service -o yaml | grep -A 5 addresses',
        annotation: 'Confirm the new pod IP is in the endpoint list. If it\'s missing, the readiness probe failed — the service is routing to nothing.',
      },
    ],
    trap: 'terminationGracePeriodSeconds: 0 is common "optimization" advice — it makes deploys feel faster. In reality it sends SIGKILL immediately, cutting all in-flight HTTP requests. Set it to match your longest expected request duration (typically 30–60s) and add a preStop: exec: [sleep, "5"] to let the load balancer drain connections before SIGTERM fires.',
    defend: 'Always define a readiness probe. Use preStop hooks to drain connections. Set terminationGracePeriodSeconds > your maximum request timeout. Add a PodDisruptionBudget (minAvailable: 1) to prevent simultaneous pod deletion during rolling updates.',
  },

  'drain-node': {
    anatomy: [
      { step: 1, text: 'kubectl drain is two operations: cordon + a loop of evictions. Cordon: PATCH node spec.unschedulable=true. Scheduler immediately skips this node for all future pod placement.' },
      { step: 2, text: 'For each non-DaemonSet pod, kubectl posts an Eviction object to /api/v1/namespaces/<ns>/pods/<name>/eviction. This is NOT a raw delete — it goes through policy enforcement first.' },
      { step: 3, text: 'The API server checks all PodDisruptionBudgets. If evicting this pod would violate a PDB (e.g., minAvailable: 1 and this is the only Running pod), the API returns 429 Too Many Requests and the drain BLOCKS until another replica is Running.' },
      { step: 4, text: 'Without a PDB: eviction proceeds exactly like a graceful delete — deletionTimestamp set, SIGTERM sent, grace period respected.' },
      { step: 5, text: 'All evicted pods enter Pending simultaneously. The scheduler races to place them on remaining nodes. If those nodes lack capacity, pods sit Pending until capacity frees up.' },
      { step: 6, text: 'After all pods are evicted, the node shows SchedulingDisabled in kubectl get nodes. It stays cordoned until you run kubectl uncordon — Kubernetes will NOT automatically restore it.' },
    ],
    verify: [
      {
        cmd: 'kubectl get pods -n kubelab -o wide | grep <node-name>',
        annotation: 'Before drain: shows all pods on the target node. Run again after drain: those pods should have moved. If any are still there after 60s, describe them — they may be stuck due to PVC affinity.',
      },
      {
        cmd: 'kubectl get nodes',
        annotation: 'Look for "SchedulingDisabled" next to the drained node. STATUS column will show Ready,SchedulingDisabled. This is the cordon flag.',
      },
      {
        cmd: 'kubectl get pods -n kubelab | grep Pending',
        annotation: 'If pods are Pending after the drain, the remaining nodes may be out of capacity. Run: kubectl describe pod <pending-pod> -n kubelab and read the Events section — the scheduler will tell you exactly why it cannot place the pod.',
      },
    ],
    trap: 'Two replicas with no pod anti-affinity and no PodDisruptionBudget. The scheduler often places both replicas on the same node because it sees available capacity there. When you drain that node, both pods are evicted simultaneously — complete downtime despite having replicas: 2. Check with: kubectl get pods -n kubelab -o wide | grep backend — if both show the same NODE, you are one drain away from an outage.',
    defend: 'Add a PodDisruptionBudget: kubectl create pdb backend-pdb --selector app=backend --min-available 1 -n kubelab. Add pod anti-affinity with topologyKey: kubernetes.io/hostname to force spread across nodes. This guarantees the drain of any single node never drops you below 1 running replica.',
  },

  'cpu-stress': {
    anatomy: [
      { step: 1, text: 'A Kubernetes Job creates a pod running stress --cpu 2. The Job controller guarantees completions: 1 — it will retry if the pod fails.' },
      { step: 2, text: 'stress forks 2 threads, each spinning in an infinite sqrt() loop — 100% CPU per thread, consuming up to 2 full cores of host CPU.' },
      { step: 3, text: 'Kubernetes enforces the 600m CPU limit via Linux cgroups (cpu.cfs_quota_us). The container is allowed 60ms of CPU time per 100ms scheduling period — 60% of one core.' },
      { step: 4, text: 'After the container exhausts its 60ms quota, the Linux CFS scheduler freezes ALL processes in the cgroup for the remaining 40ms. This is CPU throttling — not a crash, not an OOM. The process pauses.' },
      { step: 5, text: 'The container does NOT crash, does NOT restart. It runs at a throttled rate. The metric container_cpu_cfs_throttled_seconds_total climbs rapidly in Prometheus during this period.' },
      { step: 6, text: 'After 60 seconds, stress exits cleanly. The Job marks the pod Succeeded. The Job controller does NOT create another pod (completions: 1 satisfied). The pod lingers in Completed state until TTL cleanup.' },
    ],
    verify: [
      {
        cmd: 'kubectl get pods -n kubelab -w | grep cpu-stress',
        annotation: 'Watch: Pending → ContainerCreating → Running (for 60s) → Succeeded. The pod runs for exactly the duration you specified. If it exits sooner, check the job events.',
      },
      {
        cmd: 'kubectl top pods -n kubelab --sort-by=cpu | grep cpu-stress',
        annotation: 'Shows current CPU usage. You will see it pinned near 600m (the limit). This is MISLEADING — the pod is trying to use 2000m but is throttled to 600m. kubectl top shows usage, not throttling rate.',
      },
      {
        cmd: 'kubectl get jobs -n kubelab',
        annotation: 'Shows COMPLETIONS: 0/1 while running, 1/1 after success. Duration column shows how long it ran. If you see FAILED, the stress binary was OOMKilled or the image pull failed.',
      },
    ],
    trap: 'CPU throttling is invisible in kubectl top and in most basic monitoring setups. A pod maxing out its CPU limit looks identical to a healthy pod — both show "600m/600m". The symptom is high latency: requests take 2–5x longer because the container is frozen 40% of the time. Teams spend hours checking application code for a "bug" that is actually a resource limit set too low. You need Prometheus metric: rate(container_cpu_cfs_throttled_seconds_total[5m]) to see it.',
    defend: 'For latency-sensitive workloads (APIs, databases), avoid CPU limits entirely — use requests only for scheduling, leave limits unset. The Guaranteed QoS class (requests = limits) causes the most throttling. Use Burstable QoS (requests < limits) to allow brief spikes. Monitor throttle % and alert when it exceeds 25%.',
  },

  'memory-stress': {
    anatomy: [
      { step: 1, text: 'The Job pod runs stress --vm 1 --vm-bytes 400M --vm-keep. It uses mmap() to continuously allocate and touch 400MB of memory pages — this triggers actual physical memory allocation, not just virtual.' },
      { step: 2, text: 'Linux tracks anonymous memory pages per cgroup via memory.limit_in_bytes. The container limit is 200MB.' },
      { step: 3, text: 'When the working set crosses ~200MB, the kernel\'s OOM killer activates. It selects the highest-scoring process (stress, score based on memory usage) and sends SIGKILL — signal 9.' },
      { step: 4, text: 'SIGKILL cannot be caught, blocked, or ignored. There is no graceful shutdown. No preStop hook fires. No cleanup. The process terminates instantly.' },
      { step: 5, text: 'Exit code = 137 = 128 + 9 (SIGKILL signal number). Kubelet detects the container exited, records the reason as OOMKilled in pod status LastState.' },
      { step: 6, text: 'Job spec has restartPolicy: Never (default for Jobs). The Job controller marks the pod Failed and records a failure. With backoffLimit: 0 (set in our simulation), the Job itself fails — no retry.' },
    ],
    verify: [
      {
        cmd: 'kubectl get pods -n kubelab -w | grep mem-stress',
        annotation: 'The pod runs for 2–5 seconds then transitions directly from Running to OOMKilled. It does NOT go through Terminating — SIGKILL bypasses the graceful termination path entirely.',
      },
      {
        cmd: 'kubectl describe pod -n kubelab <mem-stress-pod> | grep -A 8 "Last State:"',
        annotation: 'Look for: "Reason: OOMKilled" and "Exit Code: 137". This is the definitive confirmation. If you see Exit Code: 1, the process crashed for another reason — not a memory limit violation.',
      },
      {
        cmd: 'kubectl get events -n kubelab --sort-by=.lastTimestamp | grep -i oom',
        annotation: 'The events stream will show an OOMKilling event from the kubelet. This is the only place Kubernetes records WHY the container was killed — not in pod status alone.',
      },
    ],
    trap: 'The silent restart loop. With restartPolicy: Always (the default for Deployments, not Jobs), Kubernetes restarts an OOMKilled container immediately. If the memory leak is slow, the pod runs fine for 4–8 hours, then crashes. Kubernetes restarts it — memory resets to 0, and the cycle begins again. Restart count climbs: 1, 3, 7, 15. No alert fires because CPU and memory metrics look normal between crashes. The app is effectively unreliable but the monitoring shows "green". You only notice when a user reports intermittent errors or you happen to run kubectl get pods.',
    defend: 'Alert on restart count > 2 within 60 minutes using Prometheus: kube_pod_container_status_restarts_total. Set memory requests conservatively (idle usage) and limits at your measured peak + 20% buffer. Profile memory usage with heap snapshots — add a preStop hook that sends SIGQUIT to your process to trigger a heap dump before OOM hits. Never set memory limits lower than memory requests.',
  },

  'db-failure': {
    anatomy: [
      { step: 1, text: 'PATCH /apis/apps/v1/namespaces/kubelab/statefulsets/postgres {spec: {replicas: 0}}. StatefulSet controller receives the update from its informer.' },
      { step: 2, text: 'StatefulSet deletes pods in reverse ordinal order (postgres-1 before postgres-0 in a multi-replica setup). For single replica: postgres-0 gets deletionTimestamp.' },
      { step: 3, text: 'Kubelet sends SIGTERM to the postgres process. Postgres catches SIGTERM, performs a checkpoint (writes dirty pages to disk), closes all client connections, writes a clean shutdown record to WAL.' },
      { step: 4, text: 'CRITICAL: The PersistentVolumeClaim postgres-data-postgres-0 is NOT deleted. It stays Bound. Volume unmounts from the node. All client connections get "FATAL: connection reset by peer" or "could not connect to server: Connection refused".' },
      { step: 5, text: 'Any application without connection retry/circuit breaker logic starts returning HTTP 500 or 503. If the app caches a failed connection (common with connection pools that don\'t validate), it stays broken even after Postgres restores.' },
      { step: 6, text: 'Scale back to 1: StatefulSet creates postgres-0, scheduler places it, Kubelet mounts the SAME PVC on whatever node it lands on, Postgres starts and replays WAL to reach consistent state. Existing clients that retry will reconnect.' },
    ],
    verify: [
      {
        cmd: 'kubectl get pods -n kubelab -w | grep postgres',
        annotation: 'Watch postgres-0 go through: Running → Terminating (up to 30s for checkpoint) → disappears. After restore: Pending → ContainerCreating → Running. The restore takes longer than a pod kill because Postgres replays WAL.',
      },
      {
        cmd: 'kubectl get pvc -n kubelab',
        annotation: 'This is the key verification: the PVC remains Bound even while postgres-0 is gone. STATUS=Bound, VOLUME shows the underlying PV. Your data is on that volume, not in the pod. This is what makes StatefulSets different from Deployments.',
      },
      {
        cmd: 'kubectl get statefulset postgres -n kubelab -o yaml | grep -A 3 "replicas:"',
        annotation: 'Shows spec.replicas (desired) vs status.readyReplicas (actual). During failure: status.readyReplicas=0. After restore: 1. The StatefulSet is the desired-state contract — it guarantees postgres-0 comes back with its data.',
      },
      {
        cmd: 'kubectl logs postgres-0 -n kubelab | tail -20',
        annotation: 'After restore: look for "database system was shut down" (clean shutdown record found) and "database system is ready to accept connections". If you see "database system was not properly shut down" it means Postgres is running crash recovery — this adds startup time.',
      },
    ],
    trap: 'StatefulSet + local storage = node affinity trap. If postgres-0\'s PVC uses a local volume or hostPath (tied to a specific node), and that node gets drained, postgres-0 CANNOT be rescheduled — the PVC cannot move. The pod will be Pending indefinitely with scheduler message: "0/3 nodes are available: 1 node had taint node.kubernetes.io/unschedulable, 2 node(s) didn\'t match Pod\'s node affinity/selector." The database is down until you uncordon the original node. This has caused multi-hour database outages in production.',
    defend: 'Use network-attached storage (EBS, GCE PD, Azure Disk, NFS) for StatefulSets — pods can then be rescheduled to any node. For production databases, use managed services (RDS, Cloud SQL, PlanetScale) and connect via a Service — Kubernetes manages the connection string, the cloud provider manages the data. Implement application-level connection retry with exponential backoff. Never assume a database is always available.',
  },
};

// ─── Anatomy step ─────────────────────────────────────────────────────────────
const AnatomyStep = ({ step, text }) => (
  <div className="flex gap-3">
    <div className="w-5 h-5 rounded-full bg-slate-700 text-white text-[10px] font-bold flex items-center justify-center flex-shrink-0 mt-0.5">
      {step}
    </div>
    <p className="text-xs text-slate-300 leading-relaxed">{text}</p>
  </div>
);

// ─── Kubectl command block ────────────────────────────────────────────────────
const KubectlBlock = ({ cmd, annotation }) => (
  <div className="space-y-1.5">
    <div className="flex items-start gap-2 bg-black/60 rounded-lg px-3 py-2">
      <span className="text-green-400 font-mono text-xs select-none flex-shrink-0 mt-0.5">$</span>
      <code className="font-mono text-xs text-green-300 break-all leading-relaxed">{cmd}</code>
    </div>
    <p className="text-xs text-slate-400 pl-2 leading-relaxed border-l-2 border-slate-700">{annotation}</p>
  </div>
);

// ─── Section wrapper ──────────────────────────────────────────────────────────
const Section = ({ icon: Icon, title, color, children }) => (
  <div>
    <div className={`flex items-center gap-2 mb-2.5 ${color}`}>
      <Icon className="w-4 h-4" />
      <span className="text-xs font-bold uppercase tracking-wider">{title}</span>
    </div>
    {children}
  </div>
);

// ─── DeepDive ─────────────────────────────────────────────────────────────────
const DeepDive = ({ simId }) => {
  const [open, setOpen] = useState(false);
  const content = DEEP_CONTENT[simId];
  if (!content) return null;

  return (
    <div className="mt-3">
      <button
        onClick={() => setOpen(p => !p)}
        className="flex items-center gap-2 text-xs font-semibold text-slate-600 hover:text-slate-800 transition-colors"
      >
        {open ? <ChevronUp className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
        {open ? 'Hide' : 'Show'} control-plane deep dive
      </button>

      {open && (
        <div className="mt-3 bg-slate-900 rounded-xl p-5 space-y-6">

          {/* Anatomy */}
          <Section icon={Layers} title="Control Plane Anatomy" color="text-blue-400">
            <div className="space-y-3">
              {content.anatomy.map(s => <AnatomyStep key={s.step} {...s} />)}
            </div>
          </Section>

          {/* Verify */}
          <Section icon={Terminal} title="Verify in Your Terminal" color="text-green-400">
            <div className="space-y-4">
              {content.verify.map((v, i) => <KubectlBlock key={i} {...v} />)}
            </div>
          </Section>

          {/* Production Trap */}
          <Section icon={AlertTriangle} title="The Production Trap" color="text-red-400">
            <div className="bg-red-900/30 border border-red-700/40 rounded-lg p-3">
              <p className="text-xs text-red-200 leading-relaxed">{content.trap}</p>
            </div>
          </Section>

          {/* Defend */}
          <Section icon={Shield} title="How to Defend Against This" color="text-emerald-400">
            <div className="bg-emerald-900/30 border border-emerald-700/40 rounded-lg p-3">
              <p className="text-xs text-emerald-200 leading-relaxed">{content.defend}</p>
            </div>
          </Section>

        </div>
      )}
    </div>
  );
};

export default DeepDive;

