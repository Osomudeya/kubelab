# Observability

Grafana: `http://<node-ip>:30300` — login `admin` / `kubelab-grafana-2026`

The dashboard and Prometheus data source are **auto-provisioned** — they appear immediately on first login. No manual setup.

Prometheus (ClusterIP — no NodePort):
```bash
kubectl port-forward -n kubelab svc/prometheus 9090:9090
# → http://localhost:9090
```

![Grafana dashboard](images/grafana-dashboard.png)

## Dashboard Panels

| Panel | What it shows | Check during |
|-------|--------------|--------------|
| Pod Restarts | Restart count per pod | OOMKill — watch count increment |
| Pod Status | Running / Pending / Failed | Any sim — see state transitions |
| CPU Usage | CPU per pod vs limit | CPU Stress — see throttle ceiling |
| Memory Usage | Memory per pod vs limit | Memory Stress — watch approach to 256Mi |
| Node CPU / Memory | Node-level load | Drain Node — load shifts to remaining nodes |
| HTTP Request Rate | requests/s, 2xx vs 5xx | DB Failure — watch errors spike |
| Simulation Events | Count by type per hour | Tracks which sims you've run |

## What to Watch During Each Simulation

**Kill Pod**: Pod Restarts spikes by 1. Pod Status shows brief gap then recovery.

**Drain Node**: Node CPU/Memory — load shifts from drained node to remaining nodes.

**OOMKill**: Memory Usage — pod approaches 256Mi, disappears (OOMKilled), restarts. Pod Restarts increments.

**CPU Stress**: CPU Usage — one backend pod pegged at 200m for 60s. Throttling is invisible here (panel shows usage at ceiling, not requests denied).

**DB Failure**: Pod Status — postgres-0 disappears, reappears after restore.

**Cascading Failure**: HTTP Request Rate — error spike for 5–15s when both pods die.

**Readiness Probe**: Pod Status stays flat (no restarts). HTTP errors spike on 50% of requests.

## Prometheus Queries

Run at `http://localhost:9090` (after port-forwarding):

```promql
# Pod restart rate
rate(kube_pod_container_status_restarts_total{namespace="kubelab"}[5m])

# CPU throttle rate — invisible in Grafana by default
rate(container_cpu_cfs_throttled_seconds_total{namespace="kubelab"}[5m])

# Memory usage as % of limit
container_memory_usage_bytes{namespace="kubelab"}
  / container_spec_memory_limit_bytes{namespace="kubelab"}

# Pods not Running
kube_pod_status_phase{namespace="kubelab", phase!="Running"}

# Simulation events by type
sum by (type) (increase(simulation_events_total[1h]))
```

## Troubleshooting

**Grafana shows "No data"**: `kubectl get pods -n kubelab` — confirm prometheus is Running.  
Then in Grafana: Connections → Data Sources → Prometheus → Save & Test.

**Dashboard not loading**: It auto-provisions on pod start. If missing, wait 30s and refresh.  
Force reload: `kubectl rollout restart deployment/grafana -n kubelab`

**`kubectl top` not working**: `microk8s enable metrics-server` on the control plane.
