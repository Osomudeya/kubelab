# Kubernetes Setup Guide (MicroK8s — 3-Node Cluster)

This guide walks you through creating a real 3-node Kubernetes cluster using Multipass VMs on macOS and deploying the full KubeLab stack on it. Follow every step in order.

**What you'll end up with:**
- 1 control-plane node (`microk8s-vm` — `192.168.64.5`)
- 2 worker nodes (`kubelab-worker-1` — `192.168.64.6`, `kubelab-worker-2` — `192.168.64.7`)
- All 11 KubeLab pods running across 3 nodes

---

## Prerequisites

- macOS with [Multipass](https://multipass.run) installed (`brew install --cask multipass`)
- `kubectl` installed (`brew install kubectl`)
- Docker (for building custom images — skip if using the prebuilt `veeno/kubelab-*` images, which are public and don't require a Docker Hub account)
- ~8GB of free RAM and ~60GB of free disk on your Mac

---

## Part 1 — Create the VMs

Run these commands on your Mac. Each VM gets 2 CPUs, 4GB RAM, and 20GB disk.

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

```bash
# Install MicroK8s (pinned to 1.28 for stability)
sudo snap install microk8s --classic --channel=1.28/stable

# Add your user to the microk8s group
sudo usermod -a -G microk8s $USER
sudo chown -f -R $USER ~/.kube
newgrp microk8s

# Wait until MicroK8s is fully ready
microk8s status --wait-ready
```

Enable the required addons:

```bash
microk8s enable dns
microk8s enable storage
microk8s enable metrics-server
```

> `dns` — lets pods resolve each other by name  
> `storage` — provides `hostPath`-based PersistentVolumes  
> `metrics-server` — enables `kubectl top nodes/pods`

---

## Part 3 — Configure kubectl on Your Mac

Still inside `microk8s-vm`, export the kubeconfig:

```bash
microk8s config
```

Copy the entire output. Back on your **Mac**, paste it:

```bash
# On your Mac
mkdir -p ~/.kube
multipass exec microk8s-vm -- microk8s config > ~/.kube/config-microk8s
```

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

> **Note:** The commands below (`sudo snap install`, `sudo usermod`, `microk8s join`) run **inside the Multipass VM** — not on your Mac. `multipass shell` opens a shell into the VM.

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

Back on your **Mac**:

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

`k8s/secrets.yaml` is already in the repo with working development credentials:

- **Postgres password**: `kubelab-secure-password-123`
- **Grafana login**: `admin` / `kubelab-grafana-2026`

You don't need to do anything. `deploy-all.sh` applies this file automatically.

> To use your own passwords: edit `k8s/secrets.yaml` with base64-encoded values (`echo -n "yourpassword" | base64`). The file is gitignored — it won't be committed.



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

## Part 9 — Access the Services

### Option A — NodePort (direct VM access)

```bash
# Get the control-plane IP
NODE_IP=$(kubectl get nodes -o jsonpath='{.items[0].status.addresses[?(@.type=="InternalIP")].address}')
echo "Frontend: http://$NODE_IP:30080"
echo "Grafana:  http://$NODE_IP:30300"
```

Open in your browser. Any of the 3 node IPs will work for NodePort access.

### Option B — Port-forward (works from any Mac)

```bash
# Run both in the background
kubectl port-forward -n kubelab svc/frontend 8080:80 &
kubectl port-forward -n kubelab svc/grafana 3000:3000 &
```

Then open:

| Service | URL | Credentials |
|---|---|---|
| **Frontend Dashboard** | http://localhost:8080 | — |
| **Grafana** | http://localhost:3000 | `admin` / `kubelab-grafana-2026` |
| **Prometheus** | http://localhost:9090 | — (run `kubectl port-forward -n kubelab svc/prometheus 9090:9090`) |
| **Backend API** | http://localhost:3001 | — (run `kubectl port-forward -n kubelab svc/backend 3001:3000`) |

Stop port-forwards:
```bash
pkill -f "kubectl port-forward"
```

---

## Part 10 — Open Grafana

Open `http://localhost:3000` (or `http://<node-ip>:30300`).

Login: `admin` / `kubelab-grafana-2026`

The **KubeLab Cluster Health** dashboard and the **Prometheus** data source are auto-provisioned — they load automatically when Grafana starts. No manual import or data source setup required.

You'll see live panels: pod count, node CPU/memory, HTTP request rate, restart counts, simulation events.

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
