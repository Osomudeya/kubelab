# Screenshots Needed

Take these 6 screenshots and save them here. Compress to <200KB each (use https://tinypng.com).

## 1. `dashboard.png`
- Used in: README.md
- What to capture: Full KubeLab UI after deploying, showing the pod table with all pods Running and the simulation buttons visible
- Crop to: browser viewport only, no OS chrome

## 2. `clustermap.png` (ClusterMap — from KubeLab UI, not Grafana)
- Used in: Before simulation sections (e.g. README or setup)
- What to capture: KubeLab frontend (http://localhost:8080) — cluster map with pods distributed across nodes. Ideally mid-simulation so one pod shows a different state/color.
- Where: KubeLab UI only; Grafana does not show the cluster map.

## 3. `grafana-cpu-stress.png` (Grafana during CPU stress)
- Used in: Simulation 3 (CPU Stress)
- What to capture: Grafana → KubeLab - Cluster Health Dashboard → panel **“Backend pod CPU (millicores)”** during or right after CPU Stress: one backend pod line flat at ~200m for ~60s (throttling ceiling).
- Panel: “Backend pod CPU (millicores)” (requires kubelet-cAdvisor scrape; if “No data”, use `kubectl top pods -n kubelab` as fallback for the doc).

## 4. `grafana-oomkill.png` (Grafana during OOMKill)
- Used in: Simulation 4 (OOMKill)
- What to capture: Grafana → **“Backend container memory (Mi)”** during Memory Stress: line climbing toward 256Mi, then drop to zero (OOMKill), then line reappearing (restart).
- Panel: “Backend container memory (Mi)” (requires kubelet-cAdvisor scrape; if “No data”, use terminal + `kubectl describe pod` for the doc).

## 5. `pod-kill-output.png`
- Used in: docs/simulations/pod-kill.md
- What to capture: Terminal running `kubectl get pods -n kubelab -l app=backend -w` during a pod kill — show the Terminating → Pending → Running transition
- Crop to: terminal window only

## 6. `oomkill-describe.png`
- Used in: docs/simulations/oomkill.md
- What to capture: Output of `kubectl describe pod -n kubelab <backend-pod> | grep -A 8 "Last State:"` showing `Reason: OOMKilled` and `Exit Code: 137`
- Crop to: just the Last State section

## 7. `node-drain-output.png`
- Used in: docs/simulations/node-drain.md
- What to capture: `kubectl get nodes` showing one node with `SchedulingDisabled` status during a drain
- Crop to: terminal window only

## 8. `grafana-dashboard.png`
- Used in: docs/observability.md
- What to capture: Grafana KubeLab dashboard showing at least: Pod Restarts, Pod Status, Backend pod CPU, Backend container memory (Mi), Simulation Events
- Crop to: dashboard panels only, no browser chrome

## 9. `architecture-diagram.png` (optional)
- Used in: docs/architecture.md (add manually if you create this)
- What to capture: Export the ASCII flow diagram as a proper diagram from Excalidraw or draw.io
- This one is optional — the text description in architecture.md is sufficient

