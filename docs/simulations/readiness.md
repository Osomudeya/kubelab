# Readiness Probe Failure

One backend pod fails its readiness probe for 120 seconds. Pod stays `Running`. No restart. But Kubernetes removes it from the Service — zero traffic reaches it.

**Before clicking**: open two terminals:
```bash
# Terminal 1 — watch pod status (it won't change much — that's the point)
kubectl get pods -n kubelab -w

# Terminal 2 — watch where traffic actually goes
kubectl get endpoints -n kubelab backend-service -w
```

## What You'll See

Terminal 1 (pods):
```
NAME                      READY   STATUS    RESTARTS
backend-abc-xyz           1/2     Running   0     ← READY drops from 2/2 to 1/2
backend-abc-def           2/2     Running   0     ← this one still healthy
```

Terminal 2 (endpoints):
```
NAME             ENDPOINTS
backend-service  10.1.x.x:3000,10.1.y.y:3000   ← before
backend-service  10.1.y.y:3000                  ← failing pod's IP removed
```

The failing pod is `Running` but receiving **zero traffic**. It re-enters endpoints automatically after 120 seconds (or click "Restore Readiness Now").

## What Happened

1. The `/ready` endpoint on one backend pod started returning `503`
2. Kubernetes kubelet ran the readiness probe → got `503` → marked the pod `Ready=False`
3. Endpoints controller saw `Ready=False` → removed that pod's IP from the Service
4. All new connections went to the other replica — no downtime
5. The pod's liveness probe (`/health`) still returned `200` → no restart

## Verify

```bash
kubectl describe pod -n kubelab <failing-pod> | grep -A 10 "Conditions:"
# Initialized:   True
# Ready:         False      ← not in Service endpoints
# ContainersReady: True     ← container is alive and running
# PodScheduled:  True

kubectl describe pod -n kubelab <failing-pod> | grep -A 5 "Readiness:"
# Readiness: http-get http://:3000/ready delay=5s timeout=3s period=5s
# Last probe showed: HTTP probe failed with statuscode: 503
```

## Production Insight

This is how you **intentionally** remove a pod from traffic without killing it:
- Rolling deployments: new pod's readiness probe fails until the app is ready → no traffic until healthy
- Graceful drain: fail the readiness probe → wait for in-flight requests to complete → then terminate
- Circuit breaking: detect a dependency failure → fail readiness → let other pods handle load

Misconfigured probe that's too aggressive = pod removed from rotation for a random network blip. Result: 50% of traffic silently fails while both pods show `Running` in dashboards.

**Back**: [Cascading Failure ←](cascading.md)

