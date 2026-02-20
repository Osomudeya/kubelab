# KubeLab

Break Kubernetes on purpose. Watch it self-heal.

## Quick Start

**~30 minutes. Needs 3 VMs.** Full step-by-step: [MicroK8s setup guide](setup/k8s-setup.md) · For a 5-min UI preview with mock data: [Docker Compose](setup/SETUP.md)

**Node 1 (control plane):**
```bash
git clone <repo> && cd kube-lab
./scripts/setup-cluster.sh
# Copy the join command shown at the end
```

**Node 2 & 3 (workers):**
```bash
git clone <repo> && cd kube-lab
./scripts/join-worker-node.sh <paste-join-command>
```

**Node 1:**
```bash
kubectl get nodes          # All 3 Ready?
./scripts/deploy-all.sh
```

Open: `http://<node-ip>:30080`

![KubeLab Dashboard](docs/images/dashboard.png)

Success: `kubectl get pods -n kubelab` shows 11 pods Running.

## Simulations

Run in this order — each builds on the previous:

1. [Kill Pod](docs/simulations/pod-kill.md) — Self-healing, ReplicaSets
2. [Drain Node](docs/simulations/node-drain.md) — Zero-downtime maintenance
3. [OOMKill](docs/simulations/oomkill.md) — Memory limits, exit code 137
4. [DB Failure](docs/simulations/database.md) — StatefulSet persistence
5. [CPU Stress](docs/simulations/cpu-stress.md) — Silent throttling
6. [Cascading Failure](docs/simulations/cascading.md) — When replicas aren't enough
7. [Readiness Probe](docs/simulations/readiness.md) — Running but receiving zero traffic

All 7 are in the dashboard. Each simulation page has the exact kubectl commands to run while it's happening.

## Monitoring

Grafana: `http://<node-ip>:30300` — login `admin` / `kubelab-grafana-2026`

Dashboard loads automatically. No manual import needed.

```bash
# Get your node IP:
kubectl get nodes -o jsonpath='{.items[0].status.addresses[?(@.type=="InternalIP")].address}'
```

[Grafana panel guide →](docs/observability.md)

## Troubleshooting

**Pods Pending?**
```bash
kubectl describe pod -n kubelab <name>   # read the Events section
```

**Frontend 404?** `kubectl get svc -n kubelab frontend` — NodePort should be 30080

**Backend errors?** `kubectl logs -n kubelab -l app=backend`

**Grafana no data?** `kubectl get pods -n kubelab` — check prometheus and grafana are Running

**Simulations fail (403)?**
```bash
kubectl auth can-i delete pods --as=system:serviceaccount:kubelab:kubelab-backend-sa -n kubelab
# If "no": kubectl apply -f k8s/security/rbac.yaml
```

**Node join fails?** `microk8s status` on the worker — may need `sudo usermod -a -G microk8s $USER && newgrp microk8s`

## Reference

[Architecture](docs/architecture.md) · [All Scenarios](docs/failure-scenarios.md) · [Interview Prep](docs/interview-prep.md) · [Setup Guide](setup/SETUP.md) · [MicroK8s / 3-Node Setup](setup/k8s-setup.md)
