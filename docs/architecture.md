# Architecture

```
Browser → Frontend (React/Nginx :30080)
               ↓ /api/*
          Backend (Node.js :30081)
               ↓                    ↓
          PostgreSQL          Kubernetes API
```

Backend lives inside the cluster and controls it. When you click "Kill Random Pod," the backend calls `DELETE /api/v1/namespaces/kubelab/pods/<name>` via its ServiceAccount token.

## Components

| Component | Type | Port | Notes |
|-----------|------|------|-------|
| Frontend | Deployment (1) | 30080 | React app, served by Nginx. Nginx proxies `/api/*` to backend |
| Backend | Deployment (2) | 30081 | Node.js. Calls Kubernetes API, serves cluster state to frontend |
| PostgreSQL | StatefulSet (1) | 5432 | Simulation logs. StatefulSet for stable name + PVC |
| Prometheus | Deployment (1) | 9090 (ClusterIP — port-forward to access) | Scrapes metrics every 15s, 7-day retention |
| Grafana | Deployment (1) | 30300 | Dashboards. Login: `admin` / `kubelab-grafana-2026` |
| kube-state-metrics | Deployment (1) | — | Kubernetes object metrics (pod restarts, replica counts) |
| node-exporter | DaemonSet | — | Node-level metrics (CPU, memory, disk) — one pod per node |

## Authentication

The backend uses a ServiceAccount (`kubelab-backend-sa`) — no kubeconfig file. The token is automatically mounted at `/var/run/secrets/kubernetes.io/serviceaccount/token`. The `@kubernetes/client-node` library picks it up automatically when `KUBERNETES_SERVICE_HOST` is set.

## RBAC

`kubelab-backend-role` allows — namespace-scoped to `kubelab`:

| Resource | Verbs |
|----------|-------|
| pods | get, list, watch, delete |
| nodes | get, list, watch |
| events | get, list, watch |
| jobs | get, list, watch, create, delete |
| statefulsets | get, list, watch, patch |
| endpoints | get, list, watch |
| pods/eviction | create |

No cluster-wide permissions.

## NetworkPolicies

- **Frontend**: ingress on port 80, egress to backend only
- **Backend**: ingress from frontend, egress to postgres (:5432) + kubernetes API (:443)
- **Postgres**: ingress from backend only, no egress
- **Prometheus**: scrapes all pods on :3000 (backend metrics) and :9100 (node-exporter)

## Storage

All PVCs use MicroK8s `hostpath` StorageClass — data is stored on the node's local disk. This works for a lab. In production, use network-attached storage (EBS, GCE PD) so PVCs can follow pods across nodes when a node fails.

## Why StatefulSet for Postgres?

StatefulSet guarantees:
1. Stable pod name: `postgres-0` (not `postgres-abc123`)
2. Stable PVC binding: `postgres-0` always mounts `postgres-data-postgres-0`
3. Ordered startup and shutdown

If `postgres-0` is deleted, Kubernetes recreates it with the same name and reattaches the same PVC. No data loss. A Deployment can't guarantee this.

## Why 3 Nodes?

Two worker nodes are required for the drain simulation. Draining a node evicts its pods — they need somewhere to go. With 1 worker, evicted pods stay Pending indefinitely. With 2+ workers, you can drain one and watch pods reschedule onto the other.
