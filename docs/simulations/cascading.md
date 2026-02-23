# Cascading Pod Failure

Both backend replicas die simultaneously. The Service has zero endpoints. Requests fail for 5–15 seconds.

**Before clicking**: run this in a terminal:
```bash
kubectl get endpoints -n kubelab backend -w
```

## What You'll See

```
NAME             ENDPOINTS                         AGE
backend  10.1.x.x:3000,10.1.y.y:3000     5m   ← 2 pods serving
backend  <none>                            5m   ← both dead, real downtime
backend  10.1.a.a:3000                    5m   ← first replacement ready
backend  10.1.a.a:3000,10.1.b.b:3000     5m   ← fully recovered
```

## What Happened

1. Both pods deleted simultaneously — no surviving replica to handle traffic
2. Service endpoints went empty — every request during this window fails with `Connection refused`
3. ReplicaSet controller created 2 new pods in parallel
4. Each pod went through: `Pending → ContainerCreating → Running → readiness probe passed`
5. Only after readiness passed did the Service endpoint reappear

## Verify

```bash
kubectl get events -n kubelab --sort-by=.lastTimestamp | tail -15
# Look for: two "Killing" events at the same time
#           then two "SuccessfulCreate" events
# The gap between those two pairs = actual downtime duration
```

## Production Insight

`replicas: 2` protects you from **one** pod dying at a time. It doesn't protect you from:
- Both pods landing on the same node (that node fails = both die)
- A bad deployment that crashes all new pods before rolling back
- A cluster-wide eviction triggered by resource pressure

The actual protection is:
```yaml
# pod anti-affinity: force replicas onto different nodes
affinity:
  podAntiAffinity:
    requiredDuringSchedulingIgnoredDuringExecution:
      - topologyKey: kubernetes.io/hostname

# PodDisruptionBudget: block voluntary evictions that would leave 0 replicas
minAvailable: 1
```

**Back**: [DB Failure ←](database.md) · **Next**: [Readiness Probe →](readiness.md)

