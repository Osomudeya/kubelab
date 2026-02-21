# KubeLab

Break Kubernetes on purpose. Watch it self-heal.

## What You Need

- Mac or Linux with **12GB free RAM** (3 VMs × 4GB each)
- [Multipass](https://multipass.run) — `brew install --cask multipass`
- `kubectl` — `brew install kubectl`
- ~30 minutes

**No VMs yet or just want to see the UI first?** → [5-min Docker Compose preview](setup/SETUP.md) (mock data, no cluster needed)

## Quick Start

Full step-by-step with troubleshooting: [MicroK8s setup guide](setup/k8s-setup.md)

**Node 1 (control plane):**
```bash
git clone https://github.com/Osomudeya/kubelab.git && cd kubelab
./scripts/setup-cluster.sh
# Copy the join command shown at the end
```

**Node 2 & 3 (workers):**
```bash
git clone https://github.com/Osomudeya/kubelab.git && cd kubelab
./scripts/join-worker-node.sh <paste-join-command>
```

**Node 1:**
```bash
kubectl get nodes          # All 3 Ready?
./scripts/deploy-all.sh
```

Open: `http://<node-ip>:30080`

`kubectl get pods -n kubelab` should show **11 pods Running**:

| Component | Pods |
|-----------|------|
| frontend | 1 |
| backend | 2 |
| postgres | 1 |
| prometheus | 1 |
| grafana | 1 |
| kube-state-metrics | 1 |
| node-exporter | 1 per node (2–3) |

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

After the simulations: [Interview Prep →](docs/interview-prep.md) — 10 questions this lab prepares you to answer.

## Monitoring

Grafana: `http://<node-ip>:30300` — login `admin` / `kubelab-grafana-2026`

Dashboard and data source load automatically. No manual setup needed.

```bash
# Get your node IP:
kubectl get nodes -o jsonpath='{.items[0].status.addresses[?(@.type=="InternalIP")].address}'
```

[Grafana panel guide →](docs/observability.md)

## Watch Out For

**Join tokens expire in 60 seconds.** Run `microk8s add-node` immediately before each worker joins — not 2 minutes earlier. If it fails with `connection refused`, just generate a new token.

**kubeconfig context matters.** If you have EKS or GKE configured: `kubectl config use-context microk8s` before deploying or you'll be deploying to the wrong cluster.

**Both backend pods on the same node?** `kubectl get pods -n kubelab -o wide | grep backend` — if they're on the same node, draining it takes down both replicas simultaneously. Expected — it's a lab, not production.

## Troubleshooting

**Pods Pending?** `kubectl describe pod -n kubelab <name>` → read the Events section

**Frontend 404?** `kubectl get svc -n kubelab frontend` — NodePort should be 30080

**Backend errors?** `kubectl logs -n kubelab -l app=backend`

**Grafana no data?** `kubectl get pods -n kubelab` — confirm prometheus and grafana are Running

**Simulations fail (403)?**
```bash
kubectl auth can-i delete pods --as=system:serviceaccount:kubelab:kubelab-backend-sa -n kubelab
# If "no": kubectl apply -f k8s/security/rbac.yaml
```

**Something broken and you want a clean start?** `./scripts/teardown.sh && ./scripts/deploy-all.sh`

## Reference

[Architecture](docs/architecture.md) · [All Scenarios](docs/failure-scenarios.md) · [Interview Prep](docs/interview-prep.md) · [Setup Guide](setup/SETUP.md) · [MicroK8s Setup](setup/k8s-setup.md)
