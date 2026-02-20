# Interview Prep

Questions this lab prepares you for. Each answer is 2–3 sentences referencing what you can demonstrate.

---

**"What happens when a pod crashes?"**

Kubernetes detects desired state (2 replicas) ≠ actual (1). The ReplicaSet controller creates a replacement — not a restart, a new pod with a new name. The Service routes traffic to the surviving replica the entire time; there's no downtime with `replicas: 2` and a readiness probe.

---

**"How do you do zero-downtime node maintenance?"**

`kubectl drain <node>` — cordons the node (no new pods scheduled) then evicts all pods gracefully. They reschedule on other nodes. Apply patches, then `kubectl uncordon`. I've done this in KubeLab and watched pods migrate live in `kubectl get pods -o wide -w`.

---

**"What's the difference between CPU and memory limits?"**

CPU limits throttle: the Linux CFS scheduler freezes the process periodically — it slows down but never dies. Memory limits kill: crossing the limit sends SIGKILL (exit code 137, labeled OOMKilled). In KubeLab, CPU stress shows the pod pegged at 200m but never restarting. Memory stress shows the pod die and restart.

---

**"What is a StatefulSet and when do you use it?"**

Deployments give pods random names with no storage guarantees. StatefulSets give stable names (`postgres-0`) and guaranteed PVC attachment — `postgres-0` always mounts `postgres-data-postgres-0`. When the pod crashes and restarts, same name, same data. Use for databases, Kafka, Elasticsearch.

---

**"What is a PodDisruptionBudget?"**

A PDB blocks eviction if it would violate a minimum availability constraint. `minAvailable: 1` means Kubernetes won't evict a pod if that would leave fewer than 1 running. Without a PDB, draining a node can evict all replicas if they colocated on the same node.

---

**"Explain RBAC."**

ServiceAccount → Role (namespace-scoped verbs on resources) → RoleBinding. The backend in KubeLab uses `kubelab-backend-sa` bound to a Role allowing `delete pods`, `create jobs`, `patch statefulsets` — nothing cluster-wide. If the Role is wrong, simulations return 403.

---

**"What causes CrashLoopBackOff?"**

Container exits non-zero repeatedly. Kubernetes applies exponential backoff between restarts (10s → 20s → 40s → max 5 min). Debug: `kubectl logs <pod> --previous` for crash output, `kubectl describe pod` for exit code.

---

**"How does a Service route traffic to pods?"**

Label selector. The Endpoints controller maintains the list of pod IPs matching `app=backend`. When a pod fails its readiness probe, its IP is removed from endpoints before the pod terminates — no traffic reaches a dying pod.

---

**"Readiness probe vs liveness probe?"**

Liveness: is the container alive? Fail → restart. Readiness: is it ready for traffic? Fail → removed from Service endpoints, no restart. A slow-starting app should fail readiness (not liveness), or Kubernetes restarts a healthy container that just needs warm-up time.

---

**"How would you debug high pod restart counts?"**

1. `kubectl describe pod <name>` → check `Last State` for `OOMKilled` / exit code
2. `kubectl logs <pod> --previous` → see crash output
3. `kubectl top pod <name>` → compare memory to limits

OOMKilled → raise limits or fix memory leak. Exit 1 → application bug.

---

**"What happens with no resource limits?"**

One noisy pod can consume all node CPU or memory, causing other pods to be throttled or OOMKilled. Kubernetes assigns QoS class `BestEffort` — these pods are evicted first under resource pressure.

---

**"How does Kubernetes handle a node failure?"**

After the heartbeat timeout (~5 min), Kubernetes marks the node `NotReady` and evicts pods to healthy nodes. Works only if PVCs use network-attached storage (EBS, GCE PD) — local disk is lost with the node.
