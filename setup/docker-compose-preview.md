# KubeLab Setup

Two paths. Pick one. **Multipass and kubectl work on macOS, Linux, and Windows** — use the [Multipass](https://multipass.run) and [kubectl](https://kubernetes.io/docs/tasks/tools/) install guides for your OS.

---

## Option A — Docker Compose (5 min, UI preview only)

Runs the UI and backend locally. The backend returns **mock data** — no real cluster, so failure simulations won't trigger actual Kubernetes events. Use this to explore the interface; for real simulations, use Option B or the [full setup guide](k8s-cluster-setup.md).

```bash
docker-compose up -d
```

| Service | URL |
|---------|-----|
| Frontend | http://localhost:8080 |
| Backend | http://localhost:3000 |

**Next:** Open http://localhost:8080. You'll see the UI in mock mode (amber banner). To run real simulations, follow [Option B](#option-b--real-3-node-cluster-30-min-full-experience) below or the [full setup guide](k8s-cluster-setup.md).

Full image build docs: [docker-setup.md](docker-setup.md)

---

## Option B — Real 3-Node Cluster (30 min, full experience)

### 1. Create VMs

```bash
multipass launch --name microk8s-vm      --cpus 2 --memory 4G --disk 20G 22.04
multipass launch --name kubelab-worker-1 --cpus 2 --memory 4G --disk 20G 22.04
multipass launch --name kubelab-worker-2 --cpus 2 --memory 4G --disk 20G 22.04
```

### 2. Install MicroK8s on the control plane

```bash
multipass shell microk8s-vm
sudo snap install microk8s --classic --channel=1.28/stable
sudo usermod -a -G microk8s $USER && newgrp microk8s
microk8s status --wait-ready
microk8s enable dns storage metrics-server
```

### 3. Join workers (repeat for each worker)

**Critical**: each `microk8s join` needs a fresh token — they expire in 60 seconds.

```bash
# On control plane — generates a one-time join token
microk8s add-node

# On the worker (paste the token from above)
multipass shell kubelab-worker-1
sudo snap install microk8s --classic --channel=1.28/stable
sudo usermod -a -G microk8s $USER && newgrp microk8s
microk8s status --wait-ready
microk8s join <token-from-control-plane> --worker
```

Run `microk8s add-node` again before joining worker 2.

### 4. Configure kubectl on your host (macOS/Linux/Windows)

```bash
multipass exec microk8s-vm -- microk8s config > ~/.kube/config-microk8s

# If you have other clusters (EKS, GKE), merge instead of overwrite:
KUBECONFIG=~/.kube/config:~/.kube/config-microk8s kubectl config view --flatten > ~/.kube/config
kubectl config use-context microk8s
```

On **Windows** (PowerShell), use `$env:USERPROFILE\.kube\config-microk8s` instead of `~/.kube/config-microk8s` and merge with your existing config path.

Verify: `kubectl get nodes` → should show 3 nodes `Ready`.

### 5. Build & push images (or use existing ones)

The manifests already reference `veeno/kubelab-backend` and `veeno/kubelab-frontend` on Docker Hub — you can skip this step and deploy immediately. Only do this if you've modified the source code.

```bash
./scripts/build-and-push.sh <your-dockerhub-username>
./scripts/update-manifests.sh <your-dockerhub-username>
```

### 6. Secrets

`k8s/secrets.yaml` is already in the repo with working development credentials — no action needed. `deploy-all.sh` applies it automatically.

- **Postgres**: `kubelab-secure-password-123`
- **Grafana**: `admin` / `kubelab-grafana-2026`

> To use your own passwords: `echo -n "yourpassword" | base64` then edit `k8s/secrets.yaml`. It's gitignored — safe to edit locally.

### 7. Deploy

```bash
./scripts/deploy-all.sh
```

Watch pods: `kubectl get pods -n kubelab -w` until all 11 are Running. The script applies namespace, secrets, RBAC, base app, and observability in order. Learning happens in the simulations, not in the apply step — use the script and move on.

---

## View the UI and open Grafana + Prometheus (side by side)

Run each port-forward in its own terminal, then open the URLs. **Use the KubeLab UI and Grafana together:** trigger simulations in the UI and watch Grafana at the same time so you see pod restarts, memory, and errors live.

| Service | Command | URL |
|---------|---------|-----|
| **Frontend** | `kubectl port-forward -n kubelab svc/frontend 8080:80` | http://localhost:8080 |
| **Grafana** | `kubectl port-forward -n kubelab svc/grafana 3000:3000` | http://localhost:3000 |
| **Prometheus** | `kubectl port-forward -n kubelab svc/prometheus 9090:9090` | http://localhost:9090 |

**Workflow:** Open the frontend (KubeLab UI) and Grafana in separate tabs or windows. Run a simulation (e.g. Kill Pod, Memory Stress) in the UI; watch the Cluster Health dashboard in Grafana. Grafana login: `admin` / `kubelab-grafana-2026`. Dashboard and Prometheus data source are auto-provisioned. Prometheus is optional for ad-hoc PromQL.

*Alternative (NodePort):* Frontend `http://<node-ip>:30080`, Grafana `http://<node-ip>:30300`. Prometheus has no NodePort — use port-forward.

---

## Non-obvious Things That Bite People

**Join tokens expire in 60 seconds.** Run `microk8s add-node` immediately before each worker joins. If it fails with `connection refused`, generate a new token.

**View Grafana/Prometheus:** use port-forward (see table above) → http://localhost:3000 and http://localhost:9090. NodePort alternative for Grafana only: `http://<node-ip>:30300`.

**`kubectl top` won't work** until `metrics-server` addon is enabled (step 2 above handles this).

**Kubeconfig context matters.** If you have EKS/GKE contexts, `kubectl` may be pointing at the wrong cluster. Check: `kubectl config current-context`.

---

---

## Option C — Single VM (15 min, works for 5/7 simulations)

One Multipass VM with 4GB RAM. **Node Drain** and **Cascading Failure** need a second worker — all other simulations work fine on one node.

```bash
multipass launch --name kubelab-solo --cpus 2 --memory 4G --disk 30G 22.04
multipass shell kubelab-solo
sudo snap install microk8s --classic --channel=1.28/stable
sudo usermod -a -G microk8s $USER && newgrp microk8s
microk8s status --wait-ready
microk8s enable dns storage metrics-server
```

Configure kubectl on your host:

```bash
multipass exec kubelab-solo -- microk8s config > ~/.kube/config-microk8s
KUBECONFIG=~/.kube/config:~/.kube/config-microk8s kubectl config view --flatten > ~/.kube/config
kubectl config use-context microk8s
```

Then follow **Option B steps 5–7** (secrets, deploy). Access via `http://<vm-ip>:30080`.

**Limitation**: Node Drain and Cascading Failure require 2+ workers. All other 5 simulations work perfectly on a single node.

---

## Option D — Cloud Cluster (90 seconds, full experience)

Any managed Kubernetes works — Civo free trial, DigitalOcean k3s droplet, EKS, GKE, AKS.

**Civo (recommended for speed):**
1. Sign up at [civo.com](https://www.civo.com) (free trial)
2. Create a 3-node k3s cluster (90 seconds)
3. Download kubeconfig
4. Run `./scripts/deploy-all.sh`

**DigitalOcean:**
1. Create a $6/month droplet
2. Install k3s: `curl -sfL https://get.k3s.io | sh -`
3. Copy kubeconfig: `sudo cat /etc/rancher/k3s/k3s.yaml`
4. Run `./scripts/deploy-all.sh`

No local RAM required. Full 7-simulation experience. Perfect if you don't have 12GB free for Multipass VMs.

---

Full K8s setup details and troubleshooting: [k8s-cluster-setup.md](k8s-cluster-setup.md)

