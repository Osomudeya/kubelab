# Diagnose Production Issues with KubeLab

Use this guide when you're debugging a Kubernetes issue in production and want
to reproduce it locally to understand the mechanics.

Each entry maps a symptom to the simulation that reproduces it, the exact
kubectl commands that reveal it, and what to look for.

---

## Pods restarting unexpectedly — exit code 137

**What you're seeing:**
```
kubectl get pods
NAME                    READY   STATUS    RESTARTS   AGE
backend-abc123-xk2qp   1/1     Running   7          2d
```
RESTARTS climbing over hours or days. App works between restarts but users
report intermittent errors.

**What it means:**
Exit code 137 = 128 + signal 9 (SIGKILL). The Linux kernel OOM killer terminated
the process because it exceeded its memory limit. Kubernetes saw the container
die, labeled it OOMKilled, and restarted it — memory reset to 0, cycle begins again.

**Reproduce it:**
Run the [Memory Stress simulation](simulations/oomkill.md) in KubeLab.

**Confirm in your cluster:**
```bash
# Find which pods have restarted recently
kubectl get pods -A | awk '$5 > 2'

# Check the last death reason
kubectl describe pod <pod-name> -n <namespace> | grep -A 5 "Last State:"
# Look for: Reason: OOMKilled, Exit Code: 137

# Last output before the kill (log stream stops abruptly — no shutdown message)
kubectl logs <pod-name> -n <namespace> --previous

# Check current memory vs limit
kubectl top pod <pod-name> -n <namespace>
kubectl get pod <pod-name> -n <namespace> -o jsonpath='{.spec.containers[0].resources}'
```

**Fix:**
1. If usage is consistently near the limit: raise `resources.limits.memory`
2. If usage grows over time: memory leak — profile with heap snapshots
3. Add alert: `rate(kube_pod_container_status_restarts_total[15m]) > 0.1`

---

## High latency — pods look healthy, no restarts

**What you're seeing:**
P99 latency spiked. `kubectl get pods` shows all Running, 0 restarts.
`kubectl top pods` shows CPU near the limit but not above it.

**What it means:**
CPU throttling. The Linux CFS scheduler is freezing your container periodically
to enforce the CPU limit. The process is alive — just paused up to 80% of the time.
`kubectl top` shows usage at the ceiling, not the throttle rate.

**Reproduce it:**
Run the [CPU Stress simulation](simulations/cpu-stress.md) in KubeLab.

**Confirm in your cluster:**
```bash
# kubectl top is misleading — use Prometheus instead
# Throttle rate (requires Prometheus):
rate(container_cpu_cfs_throttled_seconds_total{
  namespace="<your-namespace>",
  container="<your-container>"
}[5m])

# If this returns > 0.25, your container is throttled more than 25% of the time
# That directly maps to ~25% added latency on all requests
```

**Fix:**
1. Raise `resources.limits.cpu` — or remove it entirely for latency-sensitive workloads
2. Switch from Guaranteed QoS (requests = limits) to Burstable (requests < limits)
3. Alert on throttle rate > 25%: `rate(container_cpu_cfs_throttled_seconds_total[5m]) > 0.25`

---

## 503 errors on some requests — pods show Running, zero restarts

**What you're seeing:**
Load balancer health checks pass. `kubectl get pods` shows Running, 0 restarts.
But some requests return 503 or connection refused. Restarting pods temporarily fixes it.

**What it means:**
A pod is passing its liveness probe (keeping it alive) but failing its readiness
probe (removing it from Service endpoints). The pod is Running but receiving
zero traffic. If you have 2 replicas and one is unready, 50% of capacity is gone
but dashboards show green.

**Reproduce it:**
Run the [Readiness Probe Failure simulation](simulations/readiness.md) in KubeLab.

**Confirm in your cluster:**
```bash
# Check ready vs total containers
kubectl get pods -n <namespace>
# Look for READY column showing 0/1 or 1/2

# Check which pod IPs are actually receiving traffic
kubectl get endpoints -n <namespace> <service-name>
# Cross-reference with pod IPs: kubectl get pods -n <namespace> -o wide

# Check the exact probe status
kubectl describe pod <pod-name> -n <namespace> | grep -A 10 "Conditions:"
# Look for: Ready: False, ContainersReady: True
# This combination = alive but not in endpoints

# Application logs: see 503s for the readiness endpoint while the pod stays Running
kubectl logs <pod-name> -n <namespace> -f
```

**Fix:**
1. Check what the readiness probe is testing — if it checks a dependency (DB, cache),
   that dependency being down marks ALL pods unready
2. Separate readiness (can I serve traffic?) from dependency health (is my DB up?)
3. Use circuit breakers for dependency health — don't tie readiness to external systems

---

## Database pod crashed — worried about data loss

**What you're seeing:**
```
kubectl get pods -n <namespace> | grep postgres
postgres-0   0/1   CrashLoopBackOff   8   4h
```
Or the pod disappeared entirely. Application returning database connection errors.

**What it means:**
The pod crashed but the PersistentVolumeClaim (PVC) is a separate Kubernetes object
that outlives pods. Your data is on the volume, not in the container. The risk is
whether Postgres had time to checkpoint before dying.

**Reproduce it:**
Run the [DB Failure simulation](simulations/database.md) in KubeLab.

**Confirm in your cluster:**
```bash
# First: is the PVC still there?
kubectl get pvc -n <namespace>
# STATUS should be Bound — if so, data is safe

# Check if it was a clean shutdown or a crash
kubectl logs postgres-0 -n <namespace> --previous | tail -20
# Clean: "database system was shut down"
# Crash: "database system was not properly shut down" → recovery mode on restart

# How long will recovery take?
kubectl logs postgres-0 -n <namespace> -f
# Watch for "database system is ready to accept connections"
# WAL replay can take minutes on a large database

# Backend connection errors while Postgres is down
kubectl logs -l app=backend -n <namespace> --tail=50
```

**Fix for right now:**
If the pod is in CrashLoopBackOff, check logs for the actual crash reason:
```bash
kubectl logs postgres-0 -n <namespace> --previous
```
Common causes: out of disk space, corrupted data files, wrong permissions on PVC mount.

---

## App went down after deploying a new version

**What you're seeing:**
Deployed a new image. During rollout, the app returned 502/503 for 30-60 seconds.
Or the new pods are all CrashLoopBackOff and the old ones are gone.

**What it means:**
Either `maxUnavailable` in the rollout strategy was too high (took down too many
old pods before new ones were ready), or the new pods crash on start and Kubernetes
keeps trying to replace them.

**Reproduce it:**
Run the [Cascading Pod Failure simulation](simulations/cascading.md) in KubeLab —
this is what a simultaneous pod death looks like from the Service's perspective.

**Confirm in your cluster:**
```bash
# Check rollout history
kubectl rollout history deployment/<name> -n <namespace>

# Check what the current rollout strategy is
kubectl get deployment <name> -n <namespace> -o jsonpath='{.spec.strategy}'

# If new pods are crashing:
kubectl logs <new-pod> -n <namespace>
kubectl describe pod <new-pod> -n <namespace> | grep -A 10 "Events:"

# Roll back immediately if needed:
kubectl rollout undo deployment/<name> -n <namespace>
```

**Fix:**
1. Set `maxUnavailable: 0` and `maxSurge: 1` — never take down an old pod until
   a new one is proven healthy
2. Ensure readiness probes are configured — Kubernetes won't route traffic until
   the probe passes
3. Add `minReadySeconds: 30` — forces a new pod to stay healthy for 30s before
   the old one is removed

---

## Pods stuck Pending — node failure or maintenance

**What you're seeing:**
```
kubectl get pods -n <namespace>
NAME             READY   STATUS    RESTARTS
backend-xk2qp   0/1     Pending   0
```
`kubectl describe pod` shows scheduling failure.

**What it means:**
The scheduler can't place the pod. Common causes:
- No nodes with sufficient CPU/memory
- Node affinity or taint rules block all nodes
- PVC is on a local volume tied to a failed node (can't move)

**Reproduce the node scenario:**
Run the [Drain Node simulation](simulations/node-drain.md) in KubeLab.

**Diagnose your cluster:**
```bash
# What is the scheduler saying?
kubectl describe pod <pending-pod> -n <namespace>
# Read the "Events:" section at the bottom — the scheduler explains exactly why

# Common messages and what they mean:
# "0/3 nodes are available: 3 Insufficient memory"
#   → No node has enough free memory. Check: kubectl top nodes
#
# "0/3 nodes are available: 1 node(s) had taint NoSchedule"
#   → A taint is blocking placement. Check: kubectl describe node <node>
#
# "0/3 nodes are available: 1 node(s) didn't match pod's node affinity"
#   → Your pod spec has nodeSelector or affinity that no node matches
#
# "0/3 nodes are available: 1 node(s) had volume node affinity conflict"
#   → PVC is tied to a specific node (local storage). Pod can only run there.
```

---

## How to Use This Guide

1. Find your symptom above
2. Read the "What it means" section — understand the mechanism before reproducing
3. Run the linked simulation in KubeLab to see it happen in a safe environment
4. Use the "Confirm in your cluster" commands to diagnose your actual prod issue
5. Apply the fix

If your symptom isn't listed: open an issue and describe what you're seeing.
Most Kubernetes failure modes map to one of the 7 simulations in this lab.

---

*Built with [KubeLab](https://github.com/Osomudeya/kubelab) — break Kubernetes on purpose, watch it self-heal.*
