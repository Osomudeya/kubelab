# KubeLab

[![GitHub stars](https://img.shields.io/github/stars/Osomudeya/kubelab?style=flat-square)](https://github.com/Osomudeya/kubelab/stargazers) [![GitHub forks](https://img.shields.io/github/forks/Osomudeya/kubelab?style=flat-square)](https://github.com/Osomudeya/kubelab/network) [![GitHub release downloads](https://img.shields.io/github/downloads/Osomudeya/kubelab/total?style=flat-square)](https://github.com/Osomudeya/kubelab/releases)

Break Kubernetes on purpose. Watch it self-heal.

**New to Kubernetes?** Follow the guided path below — sequential simulations with explanations and quizzes. Takes about 90 minutes.

**Running Kubernetes in production?** Jump to [Debugging Production Issues](#debugging-production-issues) or use Explore mode in the UI (toggle in the header).

**New here?** Follow **Your path** below, step by step: 1) [Setup cluster](setup/k8s-cluster-setup.md) → 2) Deploy (`./scripts/deploy-all.sh`) → 3) Open [UI + Grafana](setup/k8s-cluster-setup.md#part-9--open-the-kubelab-ui-grafana-and-prometheus-side-by-side) side by side → 4) Run simulations in the UI in order → 5) After each sim, open the linked doc below to go deeper → 6) [Interview prep](docs/interview-prep.md).

## What You Need

- **macOS, Linux, or Windows** with **8GB free RAM minimum, 12GB recommended** (3 VMs × 4GB each for full cluster)
- [Multipass](https://multipass.run) — install for [macOS](https://multipass.run/docs/installing-on-macos) · [Linux](https://multipass.run/docs/installing-on-linux) · [Windows](https://multipass.run/docs/installing-on-windows)
- `kubectl` — [install](https://kubernetes.io/docs/tasks/tools/) (e.g. macOS: `brew install kubectl`; Linux: `snap install kubectl --classic` or package manager; Windows: `winget install Kubernetes.kubectl` or Chocolatey)
- Docker only if building your own images (prebuilt `veeno/kubelab-*` images are public; no Docker Hub account needed)
- ~30 minutes

**Can't run 3 VMs right now?** → [5-minute Docker Compose preview](setup/docker-compose-preview.md). See the full UI with mock data. Simulations return fake responses — no real cluster, no real self-healing — but you can explore every screen and read all the content. Set up a real cluster when you're ready for the actual experience.

## Quick Start

**First time?** Follow the [MicroK8s setup guide](setup/k8s-cluster-setup.md). Run each command in order — you’ll create VMs, install MicroK8s on the control plane, join workers, get kubeconfig, then deploy. The guide is the path; scripts are optional shortcuts for repeat runs.

**After the guide** (or if you already have a cluster):

```bash
git clone https://github.com/Osomudeya/kubelab.git && cd kubelab
./scripts/deploy-all.sh
```

**Verify all 11 pods are Running before you open the UI:**

```bash
kubectl get pods -n kubelab
```

Expected: 11 pods, all STATUS: Running. If any show Pending after 3 minutes, see [Troubleshooting](#troubleshooting).

**View the UI** — use port-forward, then open in browser (run each in its own terminal, or in background with `&`):

| Service | Command | URL |
|---------|---------|-----|
| **Frontend** | `kubectl port-forward -n kubelab svc/frontend 8080:80` | http://localhost:8080 |
| **Grafana** | `kubectl port-forward -n kubelab svc/grafana 3000:3000` | http://localhost:3000 (login: `admin` / `kubelab-grafana-2026`) |
| **Prometheus** | `kubectl port-forward -n kubelab svc/prometheus 9090:9090` | http://localhost:9090 |

**Monitor while you simulate:** Open the KubeLab UI (frontend) and Grafana in separate tabs or windows side by side. Trigger failures in the UI and watch Grafana at the same time — pod restarts, memory usage, HTTP errors, and simulation events update live. Prometheus (localhost:9090) is optional for ad-hoc queries. Grafana login: `admin` / `kubelab-grafana-2026`. Dashboard and Prometheus data source are auto-provisioned.

*Alternative (NodePort):* Frontend/Grafana at `http://<node-ip>:30080` and `http://<node-ip>:30300`. Prometheus is ClusterIP only — use port-forward.

Check: `kubectl get pods -n kubelab` → **11 Running**:

![KubeLab UI](docs/images/dashboard.png)

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

Run in this order in the UI — each builds on the previous. **After you run one, open the linked doc** to go deeper (commands, what to watch, production insight).

1. [Kill Pod](docs/simulations/pod-kill.md) — Self-healing, ReplicaSets
2. [Drain Node](docs/simulations/node-drain.md) — Zero-downtime maintenance
3. [CPU Stress](docs/simulations/cpu-stress.md) — Silent throttling
4. [OOMKill](docs/simulations/oomkill.md) — Memory limits, exit code 137
5. [DB Failure](docs/simulations/database.md) — StatefulSet persistence
6. [Cascading Failure](docs/simulations/cascading.md) — When replicas aren't enough
7. [Readiness Probe](docs/simulations/readiness.md) — Running but receiving zero traffic

All 7 are in the dashboard. Each linked doc has the exact kubectl commands and what to look for.

After the simulations: [Interview Prep](docs/interview-prep.md) — 10 questions this lab prepares you to answer.

## Debugging Production Issues

If you're here because something is broken in production — not to learn Kubernetes from scratch — start here:

**[Symptom → Simulation guide →](docs/diagnose.md)**

Maps what you're seeing in prod (exit code 137, high latency, 503 on some requests) to the simulation that reproduces it, with exact kubectl commands to diagnose your actual cluster.

Or use the **I'm debugging...** button in the UI to jump directly to the relevant simulation.

## Monitoring

Open Grafana and (optionally) Prometheus **next to the KubeLab UI** so you can trigger simulations in one window and watch metrics in the other. Grafana: `kubectl port-forward -n kubelab svc/grafana 3000:3000` → http://localhost:3000 (login: `admin` / `kubelab-grafana-2026`). Prometheus: `kubectl port-forward -n kubelab svc/prometheus 9090:9090` → http://localhost:9090. Dashboard and data source are auto-provisioned in Grafana.

[Which panels to watch during each simulation →](docs/observability.md)

## Watch Out For

**Join tokens expire in 60 seconds.** Run `microk8s add-node` immediately before each worker joins — not 2 minutes earlier. If it fails with `connection refused`, just generate a new token.

**kubeconfig context matters.** If you have EKS or GKE configured: `kubectl config use-context microk8s` before deploying or you'll be deploying to the wrong cluster.

**Both backend pods on the same node?** `kubectl get pods -n kubelab -o wide | grep backend` — if they're on the same node, draining it takes down both replicas simultaneously. Expected — it's a lab, not production.

## Troubleshooting

**Pods Pending?** `kubectl describe pod -n kubelab <name>` → read the Events section

**Frontend 404?** Use port-forward: `kubectl port-forward -n kubelab svc/frontend 8080:80` then open http://localhost:8080. Or check NodePort: `kubectl get svc -n kubelab frontend` (30080)

**Backend errors?** `kubectl logs -n kubelab -l app=backend`

**Grafana no data?** `kubectl get pods -n kubelab` — confirm prometheus and grafana are Running

**Simulations fail (403)?**
```bash
kubectl auth can-i delete pods --as=system:serviceaccount:kubelab:kubelab-backend-sa -n kubelab
# If "no": kubectl apply -f k8s/security/rbac.yaml
```

**Clean start?** `kubectl delete namespace kubelab` then re-run the deploy commands above (or `./scripts/deploy-all.sh`).

**Build-and-push script hangs?** It is waiting for "Push images? (y/N)". Use `./scripts/build-and-push.sh <username> latest -y` to skip the prompt. See [docker-setup.md](setup/docker-setup.md#troubleshooting).

## Reference

[Architecture](docs/architecture.md) · [All Scenarios](docs/failure-scenarios.md) · [Interview Prep](docs/interview-prep.md) · [Docker Compose preview](setup/docker-compose-preview.md) · [MicroK8s Setup](setup/k8s-cluster-setup.md)

## For Engineers Ready to Go Deeper

**[The Kubernetes Detective: Fix It Fast — Complete Troubleshooting Demo](https://osomudeya.gumroad.com/l/jabzk)** — A pod is crashing. `kubectl logs` shows nothing useful. Three engineers are watching you, and you have no idea where to start. This guide is the systematic debugging method that turns that moment from panic into a process. It's what separates engineers who guess from engineers who diagnose.

## Start Here

**The DevOps Operating System** — The structured path from confusion to a hireable engineer.

It's a 6-week curriculum built around one progression: reading → building → understanding → explaining → getting hired. The first four phases give you a working local environment, Linux, Git, Docker, and Kubernetes running on MicroK8s. After that, the curriculum moves you into realistic production scenarios: real world tickets, infrastructure tasks, and a capstone enterprise system you build end-to-end.

By the end, you won't need someone to walk you through a debugging session. You'll already know what to look for, and how to explain what you found.

→ [Access DevOps Operating System](https://osomudeya.gumroad.com/l/devops-atlas) — Founding Engineer Price ($49). Standard price moves to $149. This is the last time it's here.
