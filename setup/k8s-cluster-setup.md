# Kubernetes Setup Guide (MicroK8s — 3-Node Cluster)

This guide walks you through creating a real 3-node Kubernetes cluster using Multipass VMs on **macOS, Linux, or Windows** and deploying the full KubeLab stack. **First time? Run every command below** — you’ll see MicroK8s install, addons enable, and workers join. Done this before? Optional shortcuts: `./scripts/setup-cluster.sh` (inside the control plane VM) and `./scripts/join-worker-node.sh <token>` (on each worker).

**What you'll end up with:**
- 1 control-plane node (`microk8s-vm` — `192.168.64.5`)
- 2 worker nodes (`kubelab-worker-1` — `192.168.64.6`, `kubelab-worker-2` — `192.168.64.7`)
- All 11 KubeLab pods running across 3 nodes

---

## Prerequisites

- **Multipass** — [Install for your OS](https://multipass.run): macOS (`brew install --cask multipass`), Linux (snap or .deb from multipass.run), Windows (installer from multipass.run)
- **kubectl** — [Install](https://kubernetes.io/docs/tasks/tools/): macOS (`brew install kubectl`), Linux (`snap install kubectl --classic` or distro package), Windows (`winget install Kubernetes.kubectl` or Chocolatey)
- **Docker** — only if building custom images; prebuilt `veeno/kubelab-*` images are public (no Docker Hub account needed)
- **~8GB free RAM minimum, 12GB recommended, and ~60GB free disk** on your machine (host, not the VMs)

---

## Part 1 — Create the VMs

Run these commands on your **host** (macOS, Linux, or Windows). Each VM gets 2 CPUs, 4GB RAM, and 20GB disk.

```bash
# Control plane
multipass launch --name microk8s-vm --cpus 2 --memory 4G --disk 20G 22.04

# Worker nodes
multipass launch --name kubelab-worker-1 --cpus 2 --memory 4G --disk 20G 22.04
multipass launch --name kubelab-worker-2 --cpus 2 --memory 4G --disk 20G 22.04
```

Verify all three VMs are running:

```bash
multipass list
```

Expected output:
```
Name                State      IPv4
kubelab-worker-1    Running    192.168.64.6
kubelab-worker-2    Running    192.168.64.7
microk8s-vm         Running    192.168.64.5
```

> **Note:** Your IPs may differ. Take note of them — you'll use them throughout this guide.

---

## Part 2 — Install MicroK8s on the Control Plane

Shell into the control plane VM:

```bash
multipass shell microk8s-vm
```

Inside the VM:

**Why this matters:** MicroK8s runs Kubernetes as a snap — isolated and production-compatible. Version 1.28 is stable. You get a real cluster, not a simulator.

```bash
# Install MicroK8s (pinned to 1.28 for stability)
sudo snap install microk8s --classic --channel=1.28/stable

# Add your user to the microk8s group — without this, every kubectl needs sudo
sudo usermod -a -G microk8s $USER
sudo chown -f -R $USER ~/.kube
newgrp microk8s

# Wait until MicroK8s is fully ready (API server, etcd, scheduler)
microk8s status --wait-ready
```

**Addons** — enable these one at a time so you see what each does:

- **dns** — Without it, pods find each other only by IP (which changes on restart). With DNS, the backend can connect to `postgres` by name.
- **storage** — Containers start with an empty filesystem. This addon provides PersistentVolumes so PostgreSQL data survives pod restarts.
- **metrics-server** — Enables `kubectl top nodes` and `kubectl top pods`; also used by Horizontal Pod Autoscaler in production.

```bash
microk8s enable dns
microk8s enable storage
microk8s enable metrics-server
```

---

## Part 3 — Configure kubectl on Your Host

Still inside `microk8s-vm`, export the kubeconfig:

```bash
microk8s config
```

Copy the entire output. Back on your **host** (macOS/Linux: use `~/.kube`; Windows: use `%USERPROFILE%\.kube`), run:

```bash
# macOS/Linux
mkdir -p ~/.kube
multipass exec microk8s-vm -- microk8s config > ~/.kube/config-microk8s
```
Windows PowerShell: `multipass exec microk8s-vm -- microk8s config | Out-File -Encoding utf8 $env:USERPROFILE\.kube\config-microk8s`

If you have other clusters (EKS, GKE), merge configs instead of overwriting:

```bash
# Merge with existing kubeconfig
KUBECONFIG=~/.kube/config:~/.kube/config-microk8s kubectl config view --flatten > /tmp/merged-config
mv /tmp/merged-config ~/.kube/config

# Switch to MicroK8s context
kubectl config use-context microk8s
```

Verify it's pointing at the right cluster:

```bash
kubectl get nodes
# Should show: microk8s-vm   Ready   ...
```

---

## Part 4 — Join Worker Nodes

### 4a. Generate a join token (on the control plane)

**Why this matters:** Workers don’t know about the control plane by default. The join token is a one-time credential that lets a worker find the control plane, authenticate, and establish secure communication. Tokens expire for security.

```bash
multipass shell microk8s-vm
microk8s add-node
```

You'll see output like:

```
From the node you wish to join to this cluster, run the following:
microk8s join 192.168.64.5:25000/abcdef123456/xyz789 --worker
```

> Tokens expire in 60 seconds. Run `microk8s add-node` again if it expires.

### 4b. Set up Worker 1

> **Note:** The commands below (`sudo snap install`, `sudo usermod`, `microk8s join`) run **inside the Multipass VM** — not on your host. `multipass shell` opens a shell into the VM.

Open a new terminal tab and run:

```bash
multipass shell kubelab-worker-1
```

Inside `kubelab-worker-1`:

```bash
# Install MicroK8s
sudo snap install microk8s --classic --channel=1.28/stable
sudo usermod -a -G microk8s $USER
sudo chown -f -R $USER ~/.kube
newgrp microk8s

# Wait for ready
microk8s status --wait-ready

# Join the cluster (paste the token from Step 4a)
microk8s join 192.168.64.5:25000/<your-token-here> --worker
```

### 4c. Set up Worker 2

Generate a **new** token first (each join needs a fresh token):

```bash
# On microk8s-vm
microk8s add-node
```

Then in another terminal tab:

```bash
multipass shell kubelab-worker-2
```

Inside `kubelab-worker-2`:

```bash
sudo snap install microk8s --classic --channel=1.28/stable
sudo usermod -a -G microk8s $USER
sudo chown -f -R $USER ~/.kube
newgrp microk8s
microk8s status --wait-ready
microk8s join 192.168.64.5:25000/<your-new-token-here> --worker
```

---

## Part 5 — Verify the Cluster

Back on your **host**:

```bash
kubectl get nodes
```

Expected output:
```
NAME               STATUS   ROLES    AGE   VERSION
kubelab-worker-1   Ready    <none>   5m    v1.28.15
kubelab-worker-2   Ready    <none>   3m    v1.28.15
microk8s-vm        Ready    <none>   10m   v1.28.15
```

All three nodes must show `Ready` before you deploy.

---

## Part 6 — Secrets

Create your secrets file from the template:

```bash
cp k8s/secrets.yaml.example k8s/secrets.yaml
```

Edit `k8s/secrets.yaml` and replace the `<base64-encoded-*>` placeholders with your actual values. Generate base64 strings with:

```bash
# Example: encode a postgres password
echo -n "your-postgres-password" | base64

# Example: encode the full connection string
echo -n "postgresql://kubelab:your-postgres-password@postgres:5432/kubelab" | base64
```

The file defines two secrets:

| Secret | Field | Description |
|--------|-------|-------------|
| `postgres-secret` | `password` | PostgreSQL password (base64) |
| `postgres-secret` | `connection-string` | Full connection URI (base64) |
| `grafana-secret` | `admin-user` | Grafana admin username (pre-set to `admin`) |
| `grafana-secret` | `admin-password` | Grafana admin password (base64) |

> **Note:** `k8s/secrets.yaml` is gitignored — your credentials won't be committed. The `deploy-all.sh` script applies this file automatically during deployment.

---

## Part 7 — Deploy KubeLab

```bash
./scripts/deploy-all.sh
```

The script will:
1. Check `kubectl` is available and the cluster is reachable
2. Warn if fewer than 3 nodes are found
3. Apply secrets first (required before any workloads start)
4. Apply RBAC and NetworkPolicies
5. Deploy PostgreSQL, Backend, Frontend (in order, waiting for each)
6. Deploy kube-state-metrics, node-exporter, Prometheus, Grafana
7. Print access URLs when done

**Total time:** ~5–10 minutes depending on image pull speed.

Watch pods come up in another terminal:

```bash
watch kubectl get pods -n kubelab
```

---

## Part 8 — Run Smoke Tests

Once all pods are `Running`:

```bash
./scripts/smoke-test.sh
```

Expected output:
```
✓ PASS: Namespace exists
✓ PASS: All pods running          (11 pods)
✓ PASS: Backend health check      → {"status":"healthy"}
✓ PASS: Backend metrics endpoint  → Prometheus metrics exposed
✓ PASS: Frontend service          → NodePort 30080
✓ PASS: Prometheus targets        → 5 targets UP
✓ PASS: Grafana health            → OK
✓ PASS: Cluster status API        → pods:11 nodes:3

✅ All tests passed!
```

---

## Part 9 — Open the KubeLab UI, Grafana, and Prometheus (side by side)

You need all three running so you can trigger failures in the KubeLab UI and watch metrics in Grafana at the same time. Run each port-forward in its own terminal (or in background with `&`):

```bash
# Terminal 1 — KubeLab UI (trigger simulations here)
kubectl port-forward -n kubelab svc/frontend 8080:80
# Open http://localhost:8080

# Terminal 2 — Grafana (watch dashboards while you simulate)
kubectl port-forward -n kubelab svc/grafana 3000:3000
# Open http://localhost:3000 — login: admin / kubelab-grafana-2026

# Terminal 3 — Prometheus (optional; for ad-hoc queries)
kubectl port-forward -n kubelab svc/prometheus 9090:9090
# Open http://localhost:9090
```

**Workflow:** Open the KubeLab UI and Grafana in separate browser tabs or windows side by side. Click a simulation in the UI (e.g. Kill Pod, Memory Stress), then watch Grafana — pod restarts, memory usage, HTTP errors, and simulation events update live. No setup in Grafana: the Cluster Health dashboard and Prometheus data source are auto-provisioned.

| Service | Port-forward | URL |
|---------|--------------|-----|
| **Frontend** | `kubectl port-forward -n kubelab svc/frontend 8080:80` | http://localhost:8080 |
| **Grafana** | `kubectl port-forward -n kubelab svc/grafana 3000:3000` | http://localhost:3000 |
| **Prometheus** | `kubectl port-forward -n kubelab svc/prometheus 9090:9090` | http://localhost:9090 |

Stop port-forwards: `pkill -f "kubectl port-forward"`

*Alternative (NodePort):* Frontend at `http://<node-ip>:30080`, Grafana at `http://<node-ip>:30300`. Prometheus has no NodePort — use port-forward.

---

## Part 10 — What you see in Grafana

Open http://localhost:3000 (after starting the Grafana port-forward). Login: `admin` / `kubelab-grafana-2026`.

![KubeLab Cluster Health dashboard in Grafana](../docs/images/grafana-dashboard.png)

The **KubeLab Cluster Health** dashboard and the **Prometheus** data source are auto-provisioned — no manual import. Panels show pod count, node CPU/memory, HTTP request rate, restart counts, and simulation events. Use this dashboard while you run simulations in the KubeLab UI to see the impact in real time.

**After each simulation:** Run sims in the UI in order (Kill Pod, Drain Node, OOMKill, DB Failure, CPU Stress, Cascading, Readiness). After you run one, open the matching doc from the [README Simulations section](../README.md#simulations) to go deeper — same order. Each doc has the exact kubectl commands, what to watch, and production insight. The UI also shows a "Read the full guide" link after each sim.

---

## Troubleshooting

### Worker won't join — "connection refused"

```bash
# Check the control plane firewall allows port 25000
# On microk8s-vm:
sudo ufw allow 25000/tcp
sudo ufw allow 16443/tcp

# Verify MicroK8s is running
microk8s status
```

### Pods stuck in `Pending`

```bash
# Check which node they're trying to schedule on
kubectl describe pod <pod-name> -n kubelab | grep -A5 Events

# Common cause: not enough CPU/memory on worker nodes
kubectl top nodes

# Check if PVCs are bound
kubectl get pvc -n kubelab
```

> **We hit this**: Prometheus (500m CPU) and Grafana (250m CPU) exceeded the 1-CPU worker capacity during rolling updates. We reduced their requests to 150m and 100m respectively.

### Frontend in `CrashLoopBackOff`

```bash
kubectl logs -n kubelab -l app=frontend
```

- `bind() to 0.0.0.0:80 failed (13: Permission denied)` → nginx needs `NET_BIND_SERVICE` capability (already in `frontend.yaml`)
- `mkdir "/var/cache/nginx" failed (30: Read-only file system)` → nginx needs writable volumes (already mounted as `emptyDir`)

### kube-state-metrics crashing

```bash
kubectl logs -n kubelab -l app.kubernetes.io/name=kube-state-metrics
```

- `i/o timeout` to the API server → NetworkPolicy was blocking egress. Fixed by adding `allow-kube-state-metrics-egress` policy in `network-policies.yaml`.
- `seccomp` errors → The backend manifest uses `seccompProfile: RuntimeDefault`. MicroK8s 1.28 on Ubuntu 22.04 supports this. If you see seccomp-related errors on older kernels, edit `k8s/base/backend.yaml` and remove the `seccompProfile` block from the pod-level `securityContext`.

### Pod stuck in ContainerCreating (e.g. postgres-0)

**First:** Wait 3–5 minutes. The network on a new worker can take a moment to be ready.

**Still stuck?** Delete the pod so Kubernetes recreates it (often on a different node):

```bash
kubectl delete pod -n kubelab postgres-0
```

Watch it come back: `kubectl get pods -n kubelab -w`. If the *new* postgres pod also stays in ContainerCreating, the worker node’s network isn’t ready yet — restart that VM (`multipass restart kubelab-worker-1`), wait 2 minutes, then run the delete command again.

### Backend can't reach the Kubernetes API

```bash
# Check the RBAC ServiceAccount exists
kubectl get sa kubelab-backend-sa -n kubelab

# Check the RoleBinding
kubectl describe rolebinding -n kubelab

# Check backend logs for API errors
kubectl logs -n kubelab -l app=backend | grep -i error
```

> The `allow-backend-egress-k8s-api` NetworkPolicy in `network-policies.yaml` allows egress on port 443 to the cluster API server.

### Grafana shows "No data"

1. `kubectl get pods -n kubelab` — confirm `prometheus-*` is `Running`
2. Go to Prometheus → **Status → Targets** — all should be `UP`
3. If Prometheus pod is running but Grafana has no data: Connections → Data Sources → Prometheus → **Save & Test** (datasource is auto-provisioned but may need a manual save after the first deploy)
4. If targets are `DOWN`: check NetworkPolicy allows Prometheus egress to nodes

### kubectl pointing at wrong cluster

```bash
# List all contexts
kubectl config get-contexts

# Switch to MicroK8s
kubectl config use-context microk8s

# Verify
kubectl get nodes
```

### `smoke-test.sh` fails on backend health check

The backend container image is Node.js Alpine — it doesn't have `wget` or `curl`. The smoke test uses `node -e` to make HTTP requests. If you add custom tests, do the same.

---

## Quick Reference

```bash
# All pods
kubectl get pods -n kubelab

# All services and ports
kubectl get svc -n kubelab

# Resource usage per node
kubectl top nodes

# Logs for a deployment
kubectl logs -n kubelab -l app=backend --tail=50

# Restart a deployment
kubectl rollout restart deployment/backend -n kubelab

# Describe a pod (events + config)
kubectl describe pod -n kubelab <pod-name>

# Delete everything (destructive)
kubectl delete namespace kubelab
```

---

## What's next

1. **Run simulations in order** in the KubeLab UI (Kill Pod → Drain Node → … → Readiness).
2. **After each sim**, open the matching doc from the [README Simulations section](../README.md#simulations) or click "Read the full guide" in the UI.
3. **Interview prep:** [docs/interview-prep.md](../docs/interview-prep.md) — 10 questions this lab prepares you to answer.

---

## Cluster Summary (as built)

| Node | Role | IP | Version |
|---|---|---|---|
| `microk8s-vm` | Control Plane | `192.168.64.5` | v1.28.x |
| `kubelab-worker-1` | Worker | `192.168.64.6` | v1.28.x |
| `kubelab-worker-2` | Worker | `192.168.64.7` | v1.28.x |

> IPs and exact patch versions will differ on your machine. All three nodes are pinned to `--channel=1.28/stable` so versions should match.

| Service | Type | Port |
|---|---|---|
| Frontend | NodePort | `30080` |
| Grafana | NodePort | `30300` |
| Backend | ClusterIP | `3000` |
| Prometheus | ClusterIP | `9090` |
| PostgreSQL | ClusterIP | `5432` |

**Persistent storage:** `microk8s-hostpath` StorageClass (data lives on the control-plane node's disk).
