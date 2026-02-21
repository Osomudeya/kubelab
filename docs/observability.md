# Observability

Open Grafana (and optionally Prometheus) **next to the KubeLab UI** so you can trigger simulations in one window and watch metrics in the other. Run the port-forwards, then open both URLs:

| Service | Command | URL |
|---------|---------|-----|
| **Grafana** | `kubectl port-forward -n kubelab svc/grafana 3000:3000` | http://localhost:3000 |
| **Prometheus** | `kubectl port-forward -n kubelab svc/prometheus 9090:9090` | http://localhost:9090 |

Grafana login: `admin` / `kubelab-grafana-2026`. The Cluster Health dashboard and Prometheus data source are auto-provisioned — no manual setup. Trigger a simulation in the KubeLab UI and watch the panels update in Grafana.

**Dashboard auto-provisioning:** The dashboard is loaded automatically from ConfigMaps. `grafana-dashboard-provider` tells Grafana to read from `/var/lib/grafana/dashboards`; `grafana-dashboard-cluster-health` mounts the JSON there. No manual import — after deploy (or after a Grafana pod restart when you update the ConfigMap), the "KubeLab - Cluster Health Dashboard" appears under Dashboards.

> **After deploying:** wait 2–3 minutes for Prometheus to scrape all targets. Grafana panels may show "No data" until the first scrape completes.

## Build, push, deploy & test

**1. Build and push images** (from repo root):

```bash
./scripts/build-and-push.sh <your-dockerhub-username> latest -y
```

**2. Deploy (or update) the stack:**

- **Full deploy:** `./scripts/deploy-all.sh`  
- **Dashboard/observability only:** re-apply observability and restart Grafana so it picks up the latest dashboard JSON:
  ```bash
  kubectl apply -f k8s/observability/grafana.yaml
  kubectl apply -f k8s/observability/prometheus.yaml
  kubectl apply -f k8s/security/network-policies.yaml
  kubectl rollout restart deployment/grafana -n kubelab
  kubectl rollout restart deployment/prometheus -n kubelab
  ```

**3. Test that the new dashboard is working:**

1. Port-forward Grafana: `kubectl port-forward -n kubelab svc/grafana 3000:3000`
2. Open http://localhost:3000 → login **admin** / **kubelab-grafana-2026**
3. Go to **Dashboards** → open **"KubeLab - Cluster Health Dashboard"**
4. Set time range to **"Last 15 minutes"** and refresh.
5. Confirm these panels exist and (after 2–3 min) show data where applicable:
   - Nodes Ready, Total Pods, Pods by Status, Node CPU/Memory, HTTP Request Rate
   - **Backend pod CPU (millicores)** and **Backend container memory (Mi)** (new; need kubelet-cadvisor targets up, or they show "No data")
   - Simulation Events (Last Hour), Simulation Events by Type
6. Optional: run one simulation (e.g. Kill Pod or CPU Stress) in the KubeLab UI and confirm Simulation Events and/or Backend pod CPU update in Grafana.

## Dashboard Panels

| Panel | What it shows | Check during |
|-------|--------------|--------------|
| Nodes Ready | Count of ready nodes | Any sim |
| Total Pods | Total running pods | Any sim |
| Pod Restarts | Restart count (last hour) | OOMKill — watch count increment |
| **Nodes Cordoned** | Count of unschedulable nodes (cordoned) | **Drain Node** — 0 → 1 → 0 after Uncordon |
| Pod Status (Pods by Status) | Running / Pending / Failed | Any sim — state transitions |
| Backend pod CPU (millicores) | Per-pod CPU usage | **CPU Stress** — one pod flat at ~200m for 60s |
| Backend container memory (Mi) | Per-pod memory usage | **OOMKill** — line climbs, drops to 0, reappears |
| Node CPU / Memory | Node-level load | **Drain Node** — load shifts to remaining nodes |
| HTTP Request Rate | requests/s, 2xx vs 4xx/5xx | **DB Failure**, **Cascading**, **Readiness** — errors spike when backend or DB is down |
| Simulation Events (Last Hour) | Total sim events | Tracks which sims you've run |
| Simulation Events by Type | Breakdown by type (pod_kill, cpu_stress, etc.) | Tracks which sims you've run |

## Dashboard panels by simulation

Use this mapping to know which panels to watch for each simulation. All panels are on the single **KubeLab - Cluster Health Dashboard**; you don’t need a second dashboard.

| Simulation | Panels to watch | What you’ll see |
|------------|------------------|-----------------|
| **1. Kill Pod** | Pod Restart Count (Last Hour), Pod Restart Per Pod, Pods by Status, Total Pods | Restart count +1; brief gap in Pods by Status then recovery; Simulation Events (by type) shows `pod_kill` |
| **2. Drain Node** | **Nodes Cordoned**, Node CPU/Memory Over Time, Pods by Status, Total Pods | Nodes Cordoned → 1; load shifts on Node CPU/Memory; pods move off drained node |
| **3. OOMKill (Memory Stress)** | **Backend container memory (Mi)**, Pod Restart Count (Last Hour), Pod Restart Per Pod, Pods by Status | Memory line climbs toward 256Mi, drops to 0 (OOMKill), reappears; restarts +1; Simulation Events shows `memory_stress` |
| **4. DB Failure** | Pods by Status, Total Pods, HTTP Request Rate | postgres-0 gone then back; errors spike during outage; Simulation Events shows `db_failure` / `db_restore` |
| **5. CPU Stress** | **Backend pod CPU (millicores)**, Pod Restart Per Pod | One backend pod line flat at ~200m for ~60s; no restarts; Simulation Events shows `cpu_stress` |
| **6. Cascading Failure** | HTTP Request Rate (4xx/5xx), Pods by Status, Total Pods, Simulation Events | Error spike 5–15s; both backend pods gone then back; Simulation Events shows `kill_all_pods` |
| **7. Readiness Probe** | Pods by Status, Pod Restart Per Pod, HTTP Request Rate | No restarts; one pod out of rotation; errors spike only if both pods fail readiness; Simulation Events shows `readiness_fail` / `readiness_restore` |

**Nodes Cordoned** (new): shows how many nodes are unschedulable (cordoned). Use it during **Drain Node** — it goes from 0 to 1, then back to 0 after Uncordon.

## What to Watch During Each Simulation

**Kill Pod**: Pod Restarts spikes by 1. Pod Status shows brief gap then recovery.

**Drain Node**: **Nodes Cordoned** goes to 1. Node CPU/Memory — load shifts from drained node to remaining nodes.

**OOMKill**: **Backend container memory (Mi)** — line approaches 256Mi, drops to 0, reappears. Pod Restarts increments.

**CPU Stress**: **Backend pod CPU (millicores)** — one backend pod flat at 200m for 60s.

**DB Failure**: Pod Status — postgres-0 disappears, reappears after restore.

**Cascading Failure**: HTTP Request Rate — error spike for 5–15s when both pods die.

**Readiness Probe**: Pod Status stays flat (no restarts). HTTP errors spike if BOTH pods fail readiness simultaneously.

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

# Simulation events by type (use dashboard range, e.g. 15m)
sum by (type) (increase(simulation_events_total{job="kubelab-backend"}[$__range]))
```

## Troubleshooting

**Grafana shows "No data"**: `kubectl get pods -n kubelab` — confirm prometheus is Running.  
Then in Grafana: Connections → Data Sources → Prometheus → Save & Test.

**Dashboard not loading**: It auto-provisions on pod start. If missing, wait 30s and refresh.  
Force reload: `kubectl rollout restart deployment/grafana -n kubelab`

**`kubectl top` not working**: `microk8s enable metrics-server` on the control plane.

**Simulation ran but its type shows 0 (e.g. db_failure)**: The backend pod that handled that request **restarted** after the sim. In-memory Prometheus counters reset on process restart, so the count is lost. Run the simulation again; the dashboard should show the event (e.g. db_failure: 1) as long as that pod doesn’t restart again before the next scrape.

**Why some simulation types don't show in the dashboard**

| Simulation        | Shows in Grafana? | Why |
|------------------|-------------------|-----|
| CPU stress       | Yes               | Pod stays alive; counter is scraped. |
| DB failure       | Yes               | Pod stays alive; counter is scraped. |
| **Memory stress**| **Often no**      | The pod that increments the counter is the same pod that gets **OOMKilled**. It dies before (or right after) Prometheus' next 15s scrape, so the in-memory counter is never seen. |
| **Readiness fail** | Should show     | Pod stays Running (only readiness fails). Prometheus scrapes by **pod** (not Service), so the pod is still scraped. If it doesn't show: that pod may have restarted later (e.g. after a memory stress), wiping its metrics. |
| **DB restore**   | Should show       | Pod stays alive; code does increment `db_restore`. If it didn't show: time range might not include the click, or the pod that handled restore restarted afterward. |

So: **memory_stress** is expected to often be missing. For **readiness_fail** and **db_restore**, use "Last 15 minutes", trigger once, wait ~30s for a scrape, then refresh; if the pod that handled the request restarts later, that event will disappear from the dashboard.

---

## Before you ship / Verification checklist

Use this to confirm all observability is scraped and showing before handing the lab to students.

**1. All pods Running**

```bash
kubectl get pods -n kubelab
```

Expect: frontend (1), backend (2), postgres (1), prometheus (1), grafana (1), kube-state-metrics (1), node-exporter (1 per node). All STATUS: Running.

**2. Prometheus targets all up**

- Port-forward: `kubectl port-forward -n kubelab svc/prometheus 9090:9090`
- Open http://localhost:9090 → **Status** → **Targets**

| Job | Expected targets | Source |
|-----|------------------|--------|
| prometheus | 1 (localhost:9090) | Self |
| kubernetes-apiserver | 1 | API server |
| kube-state-metrics | 1 | kube-state-metrics pod :8080 |
| node-exporter | 2–3 (one per node) | node-exporter DaemonSet :9100 |
| kubelab-backend | 2 | Backend pods :3000 |
| kubelet-cadvisor | 2–3 (one per node) | Kubelet :10250/metrics/cadvisor |

Every target should show **State: up**. If **kubelet-cadvisor** is "down" (e.g. auth or TLS on your distro), the "Backend pod CPU" and "Backend container memory (Mi)" panels will show "No data" — use `kubectl top pods` and terminal output for those screenshots instead. If any are "down", check NetworkPolicies: Prometheus must have egress to 9090, 9100, 8080, 3000, 10250; backend, kube-state-metrics, and node-exporter must allow ingress from Prometheus.

**kubelet-cadvisor missing from Targets**: Prometheus is still using an old config. From repo root: `kubectl apply -f k8s/observability/prometheus.yaml` (this updates the ConfigMap and Deployment; the pod template annotation forces a rollout). Wait for the new Prometheus pod to be Ready, then check Targets again. Verify the ConfigMap: `kubectl get configmap prometheus-config -n kubelab -o yaml | grep -A1 kubelet-cadvisor`.

**3. Grafana datasource**

- Port-forward: `kubectl port-forward -n kubelab svc/grafana 3000:3000`
- Open http://localhost:3000 → **Connections** → **Data sources** → **Prometheus** → **Save & test**

Expect: "Data source is working". If "i/o timeout", Grafana cannot reach Prometheus — ensure NetworkPolicies allow Grafana → Prometheus on 9090.

**4. Dashboard panels and data sources**

| Panel | Metric / query | Scraped from |
|-------|----------------|---------------|
| Nodes Ready | `nodes_ready` | kubelab-backend |
| Total Pods | `sum(pods_running)` | kubelab-backend |
| Pod Restart Count | `kube_pod_container_status_restarts_total{namespace="kubelab"}` (over $__range) | kube-state-metrics |
| Pod Restart Per Pod | same | kube-state-metrics |
| Pods by Status | `pods_running` by status | kubelab-backend |
| Node CPU / Memory Over Time | `node_cpu_seconds_total`, `node_memory_*` | node-exporter |
| **Backend pod CPU (millicores)** | `container_cpu_usage_seconds_total` (kubelab, backend) | kubelet-cadvisor |
| **Backend container memory (Mi)** | `container_memory_usage_bytes` (kubelab, backend) | kubelet-cadvisor |
| HTTP Request Rate | `http_requests_total` | kubelab-backend |
| Simulation Events Timeline | `simulation_events_total{job="kubelab-backend"}` (over $__range) | kubelab-backend |
| Simulation Events by Type | same | kubelab-backend |

The dashboard defaults to **Last 15 minutes** so simulations (e.g. db_failure, pod_kill) show up within seconds. After 2–3 minutes from deploy, refresh the dashboard. Nodes Ready, Total Pods, Pods by Status, HTTP Request Rate, and Node CPU/Memory should show data. Simulation Events show data after you run at least one simulation (and only the pod that handled it is scraped).

**5. Quick sanity checks**

```bash
# Backend exposes metrics (from inside cluster; or port-forward backend 3000 first)
kubectl exec -n kubelab deploy/backend -- wget -qO- http://localhost:3000/metrics | grep -E "nodes_ready|pods_running|simulation_events_total"
```

You should see at least `nodes_ready`, `pods_running`, and `simulation_events_total` (possibly with 0). If all targets are up and the datasource tests OK, the app and observability stack are ready for students.
