# Failure Scenarios

Run in this order — each one teaches something different. **Want more detail after running one in the UI?** Use the per-scenario guides: [Kill Pod](simulations/pod-kill.md) · [Drain Node](simulations/node-drain.md) · [CPU Stress](simulations/cpu-stress.md) · [OOMKill](simulations/oomkill.md) · [DB Failure](simulations/database.md) · [Cascading](simulations/cascading.md) · [Readiness](simulations/readiness.md).

---

## 1. Kill Random Pod

**Detailed guide:** [pod-kill.md](simulations/pod-kill.md)

Deletes a backend pod. Kubernetes recreates it within 10 seconds.

```bash
kubectl get pods -n kubelab -l app=backend -w
```

Watch: `Running → Terminating` then a new pod: `Pending → Running`. Name changes — pods are immutable, this is a replacement, not a restart.

```bash
kubectl get events -n kubelab --sort-by=.lastTimestamp | tail -8
# Killing → SuccessfulCreate → Scheduled → Pulled → Started
```

**Insight**: The Service routed traffic to the surviving replica the entire time. Rising RESTARTS in production = investigate OOMKills or crashes, not the replacement itself.

**Back**: [README →](../README.md) · **Next**: [Drain Node →](#2-drain-worker-node)

---

## 2. Drain Worker Node

**Detailed guide:** [node-drain.md](simulations/node-drain.md)

Marks one node unschedulable, evicts all its pods to other nodes.

```bash
kubectl get pods -n kubelab -o wide -w   # watch NODE column change
kubectl get nodes                         # see SchedulingDisabled
```

After the simulation, click **Uncordon** in the dashboard. Or:
```bash
kubectl uncordon <node-name>
```

**Insight**: Without pod anti-affinity + PodDisruptionBudget, both backend replicas can land on the same node. One drain = complete outage despite `replicas: 2`. Check:
```bash
kubectl get pods -n kubelab -o wide | grep backend
# If both show the same NODE, you have an HA gap
```

**Back**: [Kill Pod ←](#1-kill-random-pod) · **Next**: [CPU Stress →](#3-cpu-stress)

---

## 3. CPU Stress

**Detailed guide:** [cpu-stress.md](simulations/cpu-stress.md)

Runs a stress process inside a backend pod for 60 seconds. Pod hits its 200m CPU limit and gets throttled.

```bash
kubectl top pods -n kubelab
# One backend pod pegged at ~200m for 60s. Pod never restarts.
```

**Insight**: CPU throttling is invisible. The pod is trying to use 2000m but the CFS scheduler freezes it 90% of the time. `kubectl top` shows usage at the ceiling — not what was denied. To see actual throttling:
```promql
rate(container_cpu_cfs_throttled_seconds_total{namespace="kubelab"}[5m])
```

High latency + normal-looking CPU metrics + no restarts = CPU limits set too low.

**Back**: [Drain Node ←](#2-drain-worker-node) · **Next**: [OOMKill →](#4-memory-stress-oomkill)

---

## 4. Memory Stress (OOMKill)

**Detailed guide:** [oomkill.md](simulations/oomkill.md)

Allocates memory inside a backend pod until it crosses the 256Mi limit. Linux kernel sends SIGKILL. Pod restarts.

```bash
kubectl get pods -n kubelab -l app=backend -w
# Watch: Running → OOMKilled → Running, RESTARTS increments
```

Find the evidence:
```bash
kubectl describe pod -n kubelab <backend-pod> | grep -A 8 "Last State:"
# Reason: OOMKilled
# Exit Code: 137
```

Exit 137 = 128 + 9 (SIGKILL). The Linux kernel sent it — not Kubernetes. Kubernetes only observed the exit code.

| | CPU limit | Memory limit |
|--|-----------|--------------|
| Behavior | Throttle (slow) | OOMKill (die) |
| Pod restarts? | No | Yes |
| Exit code | — | 137 |

**Insight**: The other backend replica served traffic the entire time. Slow memory leak pattern: pod runs for 8 hours → OOMKill → restart → repeat. Alert on `kube_pod_container_status_restarts_total > 3` per hour.

**Back**: [CPU Stress ←](#3-cpu-stress) · **Next**: [DB Failure →](#5-database-failure)

---

## 5. Database Failure

**Detailed guide:** [database.md](simulations/database.md)

Scales the Postgres StatefulSet to 0. Pod terminates. PVC and all data survive.

```bash
kubectl get pods,pvc -n kubelab
```

During failure: `postgres-0` is gone. PVC shows `Bound` — data is on the volume, not in the container.

```bash
kubectl get endpoints -n kubelab postgres
# During failure: ENDPOINTS: <none>
# After restore:  ENDPOINTS: 10.1.x.x:5432
```

After restoring: same pod name (`postgres-0`), same PVC reattaches, zero data loss.

**Insight**: StatefulSets guarantee `postgres-0` always gets PVC `postgres-data-postgres-0`. If the backend doesn't retry database connections, it stays broken until you restart backend pods even after Postgres recovers.

**Back**: [OOMKill ←](#4-memory-stress-oomkill) · **Next**: [Cascading Failure →](#6-cascading-pod-failure)

---

## 6. Cascading Pod Failure

**Detailed guide:** [cascading.md](simulations/cascading.md)

Kills ALL backend pods at once. With `replicas: 2`, killing one leaves a healthy replica. Killing both creates **real downtime** — the Service has zero endpoints for 5–15 seconds.

```bash
kubectl get endpoints -n kubelab backend -w
# Watch: ENDPOINTS → <none> → two new IPs
```

```bash
kubectl get events -n kubelab --sort-by=.lastTimestamp | tail -10
# Two SuccessfulDelete events at the same time. The gap before SuccessfulCreate = downtime.
```

**Insight**: `replicas: 2` protects against one pod dying. It doesn't protect against both dying simultaneously (bad deployment rollout, node running both replicas fails). Fix: pod anti-affinity + PodDisruptionBudget with `minAvailable: 1`.

**Back**: [DB Failure ←](#5-database-failure) · **Next**: [Readiness Probe →](#7-readiness-probe-failure)

---

## 7. Readiness Probe Failure

**Detailed guide:** [readiness.md](simulations/readiness.md)

Makes one backend pod fail its readiness probe for 120 seconds. The pod stays `Running` — no restart, no crash. But Kubernetes removes it from Service endpoints. All traffic goes to the other replica.

```bash
kubectl get pods -n kubelab
# STATUS: Running — the pod is alive, liveness passes
```

```bash
kubectl get endpoints -n kubelab backend
# Only 1 IP — this pod's IP disappeared
```

```bash
kubectl describe pod -n kubelab <failing-pod> | grep -A 5 "Conditions:"
# Ready: False
# ContainersReady: True   ← alive but not in rotation
```

**Insight**: This is how intentional traffic removal works — blue/green deploys, maintenance windows, graceful drains. It's also how misconfigured readiness probes cause silent partial outages: pod shows `Running`, dashboards look fine, but 50% of traffic is silently failing.

**Back**: [Cascading Failure ←](#6-cascading-pod-failure) · **Next**: [Observability →](observability.md)

---

## Quick Reference

| Simulation | Watch command | What to look for |
|-----------|---------------|-----------------|
| Kill Pod | `kubectl get pods -n kubelab -w` | Name changes on replacement |
| Drain Node | `kubectl get pods -n kubelab -o wide -w` | NODE column changes |
| CPU Stress | `kubectl top pods -n kubelab` | One pod pegged at limit |
| OOMKill | `kubectl describe pod ... \| grep "Last State" -A 8` | Exit Code: 137 |
| DB Failure | `kubectl get pvc -n kubelab` | PVC stays Bound |
| Cascading | `kubectl get endpoints -n kubelab backend -w` | ENDPOINTS → `<none>` |
| Readiness | `kubectl describe pod ... \| grep "Ready:"` | Ready: False, ContainersReady: True |
