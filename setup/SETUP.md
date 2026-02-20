# KubeLab Setup

Two paths. Pick one.

---

## Option A — Docker Compose (5 min, local only)

Runs the UI and backend locally. The backend returns **mock data** — no real cluster, so failure simulations won't trigger actual Kubernetes events. Good for exploring the interface, nothing more.

```bash
docker-compose up -d
```

| Service | URL |
|---------|-----|
| Frontend | http://localhost:8080 |
| Backend | http://localhost:3000 |

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

### 4. Configure kubectl on your Mac

```bash
multipass exec microk8s-vm -- microk8s config > ~/.kube/config-microk8s

# If you have other clusters (EKS, GKE), merge instead of overwrite:
KUBECONFIG=~/.kube/config:~/.kube/config-microk8s kubectl config view --flatten > ~/.kube/config
kubectl config use-context microk8s
```

Verify: `kubectl get nodes` → should show 3 nodes `Ready`.

### 5. Build & push images (or use existing ones)

The manifests already reference `veeno/kubelab-backend` and `veeno/kubelab-frontend` on Docker Hub — you can skip this step and deploy immediately. Only do this if you've modified the source code.

```bash
./scripts/build-and-push.sh <your-dockerhub-username>
./scripts/update-manifests.sh <your-dockerhub-username>
```

### 6. Create secrets

```bash
cp k8s/secrets.yaml.example k8s/secrets.yaml
# Edit k8s/secrets.yaml — replace placeholder values with base64-encoded passwords:
echo -n "yourpassword" | base64
```

### 7. Deploy everything

```bash
./scripts/deploy-all.sh
```

Watch it come up: `watch kubectl get pods -n kubelab`  
Done when all 11 pods show `Running`.

Run smoke tests: `./scripts/smoke-test.sh`

---

## Accessing Services

NodePort works from **any of the 3 node IPs**:

```bash
NODE_IP=$(kubectl get nodes -o jsonpath='{.items[0].status.addresses[?(@.type=="InternalIP")].address}')
echo "Frontend:   http://$NODE_IP:30080"
echo "Grafana:    http://$NODE_IP:30300"
```

For Prometheus (ClusterIP only — no NodePort):

```bash
kubectl port-forward -n kubelab svc/prometheus 9090:9090
# → http://localhost:9090
```

---

## Grafana First-Time Setup

1. Open Grafana → login `admin` / `kubelab-grafana-2026`

The Prometheus data source and Cluster Health dashboard are **auto-provisioned** — they appear on first login. No manual setup needed.

You'll see live panels for pod status, node CPU/memory, restart counts, and simulation events.

---

## Non-obvious Things That Bite People

**Join tokens expire in 60 seconds.** Run `microk8s add-node` immediately before each worker joins. If it fails with `connection refused`, generate a new token.

**Grafana opens on port 30300, not 3000.** The UI's "Open Grafana" button auto-detects your hostname. If it fails, use `http://<node-ip>:30300`.

**Prometheus is ClusterIP** — no NodePort. Always port-forward to reach it from your Mac.

**`kubectl top` won't work** until `metrics-server` addon is enabled (step 2 above handles this).

**Kubeconfig context matters.** If you have EKS/GKE contexts, `kubectl` may be pointing at the wrong cluster. Check: `kubectl config current-context`.

---

Full K8s setup details and troubleshooting: [k8s-setup.md](k8s-setup.md)

