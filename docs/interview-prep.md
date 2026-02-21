# Interview Prep

Questions this lab prepares you for. Each answer includes a short version (phone screen), a detailed version (technical interview), what you can demonstrate in KubeLab, likely follow-ups, and an answer that impresses.

---

## "What happens when a pod crashes?"

**The short answer (for a phone screen):**
Kubernetes detects desired state (2 replicas) ≠ actual (1). The ReplicaSet controller creates a replacement — not a restart, a new pod with a new name. The Service routes traffic to the surviving replica the entire time.

**The detailed answer (for a technical interview):**
When a pod is deleted or crashes, the API server sets `deletionTimestamp` on the pod object in etcd. Two things happen in parallel: the Endpoints controller removes the pod from the Service immediately (before SIGTERM fires), and the ReplicaSet controller notices actual count ≠ desired count and calls POST /pods to create a replacement.

The scheduler places the new pod on an available node. The kubelet pulls the image (usually cached), starts the container, and runs the readiness probe. Only when the probe passes does the Endpoints controller add the new pod back to the Service. Total time in a healthy cluster: 3–10 seconds.

**What I can demonstrate:**
In KubeLab I ran `kubectl get events -n kubelab -w` before deleting a pod and watched the full sequence fire: `Killing → SuccessfulCreate → Scheduled → Pulled → Started`. The replacement pod had a different name (backend-abc123 became backend-xyz789) because pods are immutable — Kubernetes never modifies them, only replaces them.

**The follow-up they'll ask:**
"What if you only have replicas: 1?" — Then there's downtime. With one replica, deleting it leaves the Service with no endpoints until the replacement is Ready. Requests get 503 or connection refused during that gap.

**The answer that impresses:**
"The real protection is readiness probes combined with replicas > 1. Without a readiness probe, the new pod receives traffic the moment its container starts — before it's opened a DB connection or loaded config. The probe is what makes zero-downtime replacement actually zero-downtime."

---

## "How do you do zero-downtime node maintenance?"

**The short answer:**
Cordon the node so no new pods land there, then evict existing pods with `kubectl drain`. The scheduler places replacements on healthy nodes. Use a PodDisruptionBudget (minAvailable: 1) so the API blocks evictions that would leave zero replicas.

**The detailed answer:**
`kubectl drain <node>` does two things: (1) cordon — sets the node unschedulable so no new pods are placed there; (2) eviction loop — for each non-DaemonSet pod, it posts an Eviction object. The API server checks PodDisruptionBudgets; if evicting would violate minAvailable, it returns 429 and the drain blocks. Without a PDB, all pods on that node can be evicted at once. Evicted pods enter Pending; the scheduler places them on remaining nodes. After the drain, run `kubectl uncordon` when the node is ready again.

**What I can demonstrate:**
In KubeLab I ran the Drain Node simulation. I had `kubectl get events -n kubelab -w` open and saw Evicted events for each pod, then `kubectl get pods -n kubelab -o wide` showed the same pods on different nodes. The drained node showed SchedulingDisabled in `kubectl get nodes`.

**The follow-up they'll ask:**
"What if both replicas were on the same node?" — Draining that node evicts both. You get a brief period with zero backend pods. Pod anti-affinity prevents that.

**The answer that impresses:**
"Always check `kubectl get pods -o wide | grep backend` before a drain. If both replicas are on the same node, you're one drain away from downtime. Add pod anti-affinity with topologyKey: kubernetes.io/hostname so the scheduler spreads them."

---

## "Walk me through what happens when you run kubectl drain on a node."

**The short answer:**
Cordon (node marked unschedulable), then for each non-DaemonSet pod the API receives an Eviction. PDBs can block. Evicted pods reschedule on other nodes.

**The detailed answer:**
First, cordon: the node's spec.unschedulable is set to true. The scheduler immediately stops placing new pods there. Then kubectl iterates over pods on the node and, for each one that isn't a DaemonSet, submits an Eviction subresource to the API. The API server evaluates PodDisruptionBudgets; if evicting this pod would violate minAvailable (e.g. you'd go from 1 to 0), it returns 429 and the drain blocks until another replica is Running. If allowed, the pod gets a deletionTimestamp, SIGTERM is sent, and after the grace period it's removed. The scheduler places the pod (now Pending) on another node. When all pods are evicted, the node shows SchedulingDisabled. You must run `kubectl uncordon` to make it schedulable again — Kubernetes does not auto-uncordon.

**What I can demonstrate:**
KubeLab's Drain Node simulation. I watched `kubectl get events -n kubelab -w` and saw Evicted for each pod, then `kubectl get pods -n kubelab -o wide` showed pods on the remaining nodes. The drained node stayed cordoned until I ran uncordon.

**The follow-up they'll ask:**
"What's the difference between cordon and drain?" — Cordon only marks the node unschedulable; it doesn't evict. Drain = cordon + evict all.

**The answer that impresses:**
"Eviction is a subresource, not a raw DELETE. It goes through admission and PDB checks. That's why a drain can block — the API is protecting you from dropping below minAvailable."

---

## "Your monitoring shows a pod restarting every 6 hours but everything looks fine between restarts. How do you debug it?"

**The short answer:**
Check Last State in `kubectl describe pod` for OOMKilled and exit code 137. Check memory usage vs limit. Restarts at a fixed interval often mean the process hits the memory limit, gets killed, and the cycle repeats.

**The detailed answer:**
First, confirm the restart reason: `kubectl describe pod <name> -n <namespace>` and look at "Last State: Terminated" — Reason and Exit Code. Exit code 137 = OOMKilled (128 + 9). Then compare current usage to the limit: `kubectl top pod` and `kubectl get pod -o jsonpath='{.spec.containers[0].resources}'`. If usage is near the limit, the container is hitting it periodically (e.g. a slow leak or a batch job that peaks every 6 hours). Prometheus: alert on `rate(kube_pod_container_status_restarts_total[15m]) > 0.1`. The "everything looks fine between restarts" is because after each kill, memory resets to zero and the pod is healthy until it grows again.

**What I can demonstrate:**
KubeLab's Memory Stress simulation. I ran it and watched the pod get OOMKilled — `kubectl describe pod` showed Reason: OOMKilled, Exit Code: 137. The RESTARTS counter incremented. That's exactly the silent restart loop: healthy until the limit is hit, then kill, then healthy again.

**The follow-up they'll ask:**
"What if it's not OOMKilled?" — Then check exit code and `kubectl logs <pod> --previous` for the crash output. Exit 1 = application error; 137 = OOM; 143 = SIGTERM (graceful shutdown).

**The answer that impresses:**
"Alert on restart rate, not just restart count. A pod that restarts once at 3am and once at 9am has restarts: 2 but a pattern. rate(...[15m]) > 0.1 catches the 'every 6 hours' loop before users do."

---

## "What's the difference between CPU and memory limits?"

**The short answer:**
CPU limits throttle: the process is paused periodically but stays alive. Memory limits kill: exceeding the limit triggers the kernel OOM killer (SIGKILL, exit 137). Throttling is invisible in `kubectl top`; OOMKill is visible in describe and RESTARTS.

**The detailed answer:**
CPU: the Linux CFS scheduler enforces the limit by throttling — the process is frozen for part of each period. It never gets a signal; it just runs slower. The pod stays Running, RESTARTS don't increment. `kubectl top` shows usage at the ceiling (e.g. 200m) but doesn't show how much time was throttled; you need Prometheus `container_cpu_cfs_throttled_seconds_total`. Memory: the limit is hard. When the process exceeds it, the kernel OOM killer sends SIGKILL (exit 137). The container dies, Kubernetes restarts it. You see OOMKilled in describe and RESTARTS increment.

**What I can demonstrate:**
In KubeLab, CPU Stress: the pod stayed Running for 60s at 200m, no restart. Memory Stress: the pod was OOMKilled, RESTARTS went up, describe showed Reason: OOMKilled, Exit Code: 137.

**The follow-up they'll ask:**
"Should you set CPU limits?" — For latency-sensitive workloads, often no. Throttling adds tail latency. Use requests for scheduling and omit limits, or use Burstable QoS.

**The answer that impresses:**
"CPU limits are a trade-off: you get predictable cost but unpredictable latency. Memory limits are non-negotiable — without them one pod can OOMKill the node and take down everyone."

---

## "What is a StatefulSet and when do you use it?"

**The short answer:**
StatefulSets give pods stable names (postgres-0, postgres-1) and stable storage: each pod gets a PVC that survives restarts. Use for stateful workloads: databases, Kafka, Elasticsearch. Deployments give random names and no per-pod identity.

**The detailed answer:**
Deployments create pods with random suffixes; ReplicaSet doesn't guarantee which pod gets which volume. StatefulSets create pods in order (pod-0, pod-1) and each can have a volumeClaimTemplate — so postgres-0 always mounts the same PVC. When the pod is recreated (crash, drain), the same name and same PVC attach. That's why you use it for databases: identity and data stick together. Headless Service (clusterIP: None) is typically used so pods get stable DNS (postgres-0.postgres).

**What I can demonstrate:**
KubeLab's DB Failure simulation. I scaled Postgres to 0 and back. The PVC stayed Bound the whole time. When the pod came back, it was still postgres-0 and reattached to the same volume — no data loss.

**The follow-up they'll ask:**
"What about Deployment with a single replica and a PVC?" — The PVC can attach to the new pod, but you don't get ordered rollout or stable identity. For a single DB it can work; for a cluster (Kafka, etc.) you need StatefulSet.

**The answer that impresses:**
"StatefulSet is for when pod identity matters — not just storage, but which pod is which. Kafka broker 0 vs 1 have different roles; the name and the volume are part of that identity."

---

## "What is a PodDisruptionBudget?"

**The short answer:**
A PDB declares minimum availability (e.g. minAvailable: 1). The API server blocks voluntary disruptions (evictions, drain) that would violate it. It doesn't protect against node failure or OOM.

**The detailed answer:**
You create a PDB with a label selector and minAvailable or maxUnavailable. When something tries to evict a pod (drain, cluster autoscaler), the API checks: would this eviction leave fewer than minAvailable? If yes, it returns 429 and the eviction is rejected. The drain blocks until another replica is Running. So PDB prevents you from draining the last replica. It doesn't protect against involuntary disruptions (node failure, OOM on the node) — only voluntary ones.

**What I can demonstrate:**
In KubeLab's Drain Node simulation, the guide explains that without a PDB and without pod anti-affinity, both replicas can be on the same node; one drain evicts both. With minAvailable: 1, the second eviction would be blocked.

**The follow-up they'll ask:**
"What if I set minAvailable: 2 and only have 2 replicas?" — Then no voluntary eviction can happen (evicting any one would leave 1). Your node drain would block. You need to scale up or relax the PDB during maintenance.

**The answer that impresses:**
"PDB is a safety net for voluntary disruption. Combine it with pod anti-affinity so your replicas are spread — then drain never drops you below minAvailable because the other replica is on another node."

---

## "Explain RBAC."

**The short answer:**
ServiceAccount → Role (or ClusterRole) → RoleBinding (or ClusterRoleBinding). Roles define verbs on resources in a namespace; bindings link identities to roles. KubeLab's backend uses a Role allowing delete pods, create jobs, patch statefulsets in the kubelab namespace.

**The detailed answer:**
You create a ServiceAccount. You create a Role (namespace-scoped) or ClusterRole (cluster-scoped) that lists rules: apiGroups, resources, verbs (get, list, create, delete, etc.). You create a RoleBinding that says "this ServiceAccount has this Role in this namespace." Pods run as a ServiceAccount; when they call the API, the API server checks whether that identity has the right verb on the resource. No binding = 403.

**What I can demonstrate:**
In KubeLab, the backend pod runs as kubelab-backend-sa. The simulations (kill pod, drain, db failure, etc.) work because the Role allows the right verbs. If I removed the RoleBinding, the UI would show 403 for those actions.

**The follow-up they'll ask:**
"Role vs ClusterRole?" — Role is namespace-scoped. ClusterRole can be used in multiple namespaces (via RoleBinding per namespace) or for cluster-scoped resources (nodes, PVs).

**The answer that impresses:**
"Least privilege: give the app only the verbs it needs. The backend doesn't need get nodes cluster-wide; it needs delete pods and patch statefulsets in one namespace. That's a Role + RoleBinding."

---

## "What causes CrashLoopBackOff?"

**The short answer:**
The container exits with a non-zero code repeatedly. Kubernetes restarts it with exponential backoff (10s, 20s, 40s, … up to 5 min). Debug with `kubectl logs <pod> --previous` and `kubectl describe pod` for exit code and reason.

**The detailed answer:**
Every time the container exits non-zero, the kubelet restarts it after a delay. The delay doubles each time (capped at 5 minutes) — that's the "BackOff." So CrashLoopBackOff means: it's crashing, we're waiting before the next restart. Common causes: application error (exit 1), OOMKilled (137), image pull or startup failure. Check Last State in describe for the reason and exit code; check logs --previous for the process output.

**What I can demonstrate:**
In KubeLab, the Memory Stress simulation causes an OOMKill — that's one form of "crash." The pod goes Terminating then a new container starts. If the app kept exceeding memory every time, you'd see CrashLoopBackOff. The fix is either raise the limit or fix the leak.

**The follow-up they'll ask:**
"How do you stop the backoff?" — Fix the root cause. You can delete the pod to reset the backoff counter, but it'll crash again unless you fix the image, config, or resources.

**The answer that impresses:**
"BackOff is there so a broken pod doesn't hammer the node. But it also means your alert might fire only after 5 minutes. So alert on the crash (e.g. OOMKilled) as well as the restart count."

---

## "How does a Service route traffic to pods?"

**The short answer:**
The Service has a label selector. The Endpoints controller maintains a list of pod IPs that match that selector. Kube-proxy (or the CNI) programs the node so traffic to the Service IP is forwarded to one of those IPs. When a pod fails readiness, the Endpoints controller removes its IP — so no traffic reaches it.

**The detailed answer:**
Service is a virtual IP and a selector. The Endpoints controller continuously watches pods and updates the Endpoints object with the IPs of pods that match the selector and are Ready (readiness probe passed). So "routing" is: packet hits Service IP → kube-proxy/iptables or CNI chooses an endpoint IP → packet goes to that pod. If a pod fails its readiness probe, the controller removes it from Endpoints before the pod is terminated — so in-flight requests aren't sent to a dying pod.

**What I can demonstrate:**
In KubeLab, after killing a pod, `kubectl get endpoints -n kubelab backend` — you see the list of pod IPs. When one pod is Terminating, its IP is already gone from endpoints. The Readiness Probe simulation shows a pod that's Running but not in endpoints (failing readiness), so 50% of traffic fails.

**The follow-up they'll ask:**
"ClusterIP vs NodePort vs LoadBalancer?" — ClusterIP is internal only. NodePort exposes a port on every node. LoadBalancer is for cloud LBs. All use the same Endpoints list.

**The answer that impresses:**
"Traffic only goes to Ready pods. So readiness isn't just 'can I serve' — it's the switch that controls whether your pod gets traffic at all. Get it wrong and you get 503 or no traffic."

---

## "Readiness probe vs liveness probe?"

**The short answer:**
Liveness: is the process alive? Fail → restart. Readiness: is it ready for traffic? Fail → remove from Service endpoints, no restart. Use readiness for "can I serve"; use liveness only for "is the process dead."

**The detailed answer:**
Liveness failure = Kubernetes restarts the container. Use it when the process can get into a state where it's running but never recovers (deadlock, hung). Readiness failure = pod is removed from Service endpoints; no restart. Use it when the pod is temporarily unable to serve (starting up, dependency down). A slow-starting app should fail readiness, not liveness — otherwise Kubernetes restarts a healthy container that just needs 30 seconds to open a DB connection.

**What I can demonstrate:**
KubeLab's Readiness Probe Failure simulation. The pod stays Running (liveness passes) but fails readiness — so it's not in endpoints. Half the requests get 503 because only one replica is receiving traffic.

**The follow-up they'll ask:**
"What if I use the same command for both?" — If that command fails (e.g. dependency down), liveness fails and Kubernetes restarts the pod. That can make an outage worse. Readiness is "don't send traffic"; liveness is "assume the process is dead."

**The answer that impresses:**
"Readiness is the one that affects traffic. Liveness is a last resort — only for when the process is stuck and will never recover. Don't tie liveness to dependencies or you'll restart healthy pods when the DB is slow."

---

## "How would you debug high pod restart counts?"

**The short answer:**
`kubectl describe pod` → Last State (OOMKilled? exit code?). `kubectl logs <pod> --previous` for crash output. `kubectl top pod` vs limits. OOMKilled → raise limit or fix leak; exit 1 → app bug.

**The detailed answer:**
(1) Describe the pod — look at Last State: Terminated. Reason (OOMKilled, Error) and Exit Code (137 = OOM, 1 = app error). (2) Logs from the previous instance: `kubectl logs <pod> -n <ns> --previous` to see what the process printed before dying. (3) Compare memory: `kubectl top pod` and the pod's resources.limits.memory. If usage was near the limit, it's OOM. (4) Alert on restart rate: `rate(kube_pod_container_status_restarts_total[15m]) > 0.1` so you see the pattern before users do.

**What I can demonstrate:**
In KubeLab, Memory Stress causes OOMKill — describe shows OOMKilled, 137. So for high restarts in prod, I'd do the same: describe for reason, logs --previous for stack trace, top for memory.

**The follow-up they'll ask:**
"What if describe shows no Last State?" — Then the pod might be getting killed by something else (node OOM, preemption). Check node events and node memory.

**The answer that impresses:**
"Restart count alone doesn't tell you why. Exit code 137 + memory near limit = OOM. Exit 1 + logs = app bug. Exit 143 = SIGTERM, so something is killing it gracefully (preemption, drain). The number is a signal; describe and logs are the diagnosis."

---

## "What happens with no resource limits?"

**The short answer:**
Pods can use unbounded CPU and memory. One noisy pod can starve others (CPU) or trigger node OOM (memory). Kubernetes gives them QoS BestEffort; they're evicted first under pressure.

**The detailed answer:**
Without limits, the scheduler uses requests (if set) for placement but doesn't cap usage. So a pod can consume all node CPU — other pods get throttled or starved. Or it can consume all memory — the node OOM killer may kill other pods or the node can OOM. QoS: no requests and no limits = BestEffort; with requests but no limits = Burstable; requests = limits = Guaranteed. Under memory pressure, BestEffort is evicted first, then Burstable. So "no limits" is risky for the whole node.

**What I can demonstrate:**
KubeLab's Memory Stress simulation runs inside a pod with a 256Mi limit — when it exceeds that, it gets OOMKilled. Without that limit, the same allocation could have killed other pods on the node or the node itself.

**The follow-up they'll ask:**
"So should I always set limits?" — For memory, usually yes (or at least requests so the scheduler reserves space). For CPU, it's a trade-off: limits prevent noisy neighbors but add throttling; many teams omit CPU limits for latency-sensitive apps.

**The answer that impresses:**
"Memory limits protect the node and other pods. CPU limits protect fairness but add latency. So: memory limits almost always; CPU limits when you care about cost predictability and accept latency risk."

---

## "How does Kubernetes handle a node failure?"

**The short answer:**
After the node heartbeat timeout (default ~40s to 5 min depending on config), the control plane marks the node NotReady. Pods on it are considered failed. The ReplicaSet (or other controller) sees desired ≠ actual and creates replacements on healthy nodes. Works only if storage is network-attached (EBS, NFS); local volumes are lost with the node.

**The detailed answer:**
Kubelet on the node sends heartbeats. When they stop (node died, network partition), the control plane waits for the timeout (node-monitor-grace-period, often 40s). Then the node status becomes NotReady (or Unknown). The scheduler doesn't place new pods there. For existing pods: they're not immediately deleted — the control plane may set a taint or wait. ReplicaSet sees that desired count (e.g. 2) doesn't match actual (1 running, 1 on dead node), so it creates a new pod. The new pod gets scheduled on a healthy node. If the pod had a PVC, the volume must be attachable from another node — so ReadWriteOnce with EBS/GCE PD works; local storage doesn't.

**What I can demonstrate:**
KubeLab's Drain Node simulation is the "voluntary" version — we remove the node from scheduling and evict pods. The involuntary version (node failure) has the same outcome: pods need to run elsewhere. The difference is drain is graceful (SIGTERM, eviction); node failure is detected after timeout and then replacements are created.

**The follow-up they'll ask:**
"What about StatefulSet pods on the failed node?" — Same idea: the StatefulSet controller creates a replacement with the same name. The PVC (if network-attached) can be attached to the new node. If the volume was local to the dead node, the replacement pod stays Pending until storage is available.

**The answer that impresses:**
"Node failure is eventually consistent. There's a window (heartbeat timeout) where the control plane doesn't know the node is dead. During that time, pods on that node are still 'Running' in the API — so your replica count can be wrong until the timeout. That's why you want replicas > 1 and readiness probes so the surviving pods handle traffic."

---

*Use KubeLab to run each simulation and see these mechanics live. Then use this doc to articulate them in an interview.*
