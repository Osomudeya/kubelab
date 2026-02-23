# CPU Stress

Runs `stress --cpu 2` inside a backend pod for 60 seconds. Pod hits its 200m CPU limit and gets throttled. Pod never restarts.

**Before clicking**: open a terminal:
```bash
watch -n 2 kubectl top pods -n kubelab
```

## What You'll See

```
NAME                         CPU(cores)   MEMORY(bytes)
backend-6d4f8b9c7-xk2qp     200m         88Mi    ← pegged at limit for 60s
backend-6d4f8b9c7-rp9ms     15m          82Mi    ← normal
```

The stressed pod is pinned at 200m. The pod never restarts. The other replica keeps serving requests normally.

## How Throttling Works

The Linux CFS scheduler enforces CPU limits via cgroups:

- Container gets 200m = 20ms of CPU time per 100ms scheduling period
- `stress` requests 2 full cores (2000m)
- Kernel grants 20ms of CPU, then **freezes all processes in the cgroup for 80ms**
- The container runs at 10% of what it asked for

The pod isn't slow because it's broken. It's slow because it's frozen 80% of the time.

## The Invisible Problem

```bash
kubectl top pods -n kubelab
# Shows: 200m — looks like "using its limit normally"
# Does NOT show: was denied 1800m, running 10x slower than it should
```

To see actual throttle rate:
```promql
rate(container_cpu_cfs_throttled_seconds_total{namespace="kubelab"}[5m])
```

This is the most common invisible production problem: **high latency with normal-looking CPU metrics and zero restarts**. Teams spend hours checking application code for a "bug" that is actually a CPU limit set too low.

## Production Insight

For latency-sensitive services (APIs, databases): remove CPU limits, keep only CPU requests. Requests tell the scheduler where to place the pod. Limits cause unpredictable latency spikes with no visible signal.

```yaml
resources:
  requests:
    cpu: "200m"    # keep — for scheduling
  # limits:        # consider removing for APIs
  #   cpu: "200m"  # this causes throttling
```

Alert on throttle % when it exceeds 25% of total CPU time.

**Back**: [Drain Node ←](node-drain.md) · **Next**: [OOMKill →](oomkill.md)

