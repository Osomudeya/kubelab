# Database Failure

Scales the Postgres StatefulSet to 0 replicas. Pod terminates completely. PVC and all data survive.

**Before clicking**: open a terminal:
```bash
kubectl get pods,pvc -n kubelab
```

## What You'll See

```
NAME           READY   STATUS        RESTARTS
postgres-0     1/1     Terminating   0          ← pod dying
# postgres-0 disappears

NAME                              STATUS   VOLUME
postgres-data-postgres-0          Bound    pvc-xxx   ← PVC stays Bound
```

The pod is gone. The PVC is not.

## Restore

Click **Restore Database** in the dashboard. Same pod name comes back:

```
postgres-0     0/1     Pending       0     ← scheduling
postgres-0     1/1     Running       0     ← back, same PVC reattached
```

```bash
kubectl get endpoints -n kubelab postgres
# During failure: ENDPOINTS: <none>
# After restore:  ENDPOINTS: 10.1.x.x:5432
```

## StatefulSet vs Deployment

| | Deployment | StatefulSet |
|--|-----------|-------------|
| Pod names | Random (`backend-abc123`) | Stable (`postgres-0`) |
| PVC binding | Not guaranteed | `postgres-0` always mounts `postgres-data-postgres-0` |
| On restart | May get different storage | Same name, same PVC, same data |

This is why StatefulSets exist. A Deployment for a database would mean each restart could mount a different (empty) PVC.

## What Happens to the Application?

Backend gets `ECONNREFUSED` when querying `postgres:5432`. If the app retries connections with backoff, it recovers automatically when Postgres comes back. If the app caches a failed connection (common with connection pools), it stays broken — restart backend pods after restoring the DB.

## Production Insight

Scale-to-zero is a real operations pattern for non-production databases:
```bash
# Save compute costs overnight
kubectl scale statefulset postgres --replicas=0 -n staging

# Restore in the morning
kubectl scale statefulset postgres --replicas=1 -n staging
```

Data persists. Never do this to production.

**Back**: [OOMKill ←](oomkill.md) · **Next**: [CPU Stress →](cpu-stress.md)

