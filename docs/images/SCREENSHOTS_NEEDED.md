# Screenshots Needed

Take these 6 screenshots and save them here. Compress to <200KB each (use https://tinypng.com).

## 1. `dashboard.png`
- Used in: README.md
- What to capture: Full KubeLab UI after deploying, showing the pod table with all pods Running and the simulation buttons visible
- Crop to: browser viewport only, no OS chrome

## 2. `pod-kill-output.png`
- Used in: docs/simulations/pod-kill.md
- What to capture: Terminal running `kubectl get pods -n kubelab -l app=backend -w` during a pod kill — show the Terminating → Pending → Running transition
- Crop to: terminal window only

## 3. `oomkill-describe.png`
- Used in: docs/simulations/oomkill.md
- What to capture: Output of `kubectl describe pod -n kubelab <backend-pod> | grep -A 8 "Last State:"` showing `Reason: OOMKilled` and `Exit Code: 137`
- Crop to: just the Last State section

## 4. `node-drain-output.png`
- Used in: docs/simulations/node-drain.md
- What to capture: `kubectl get nodes` showing one node with `SchedulingDisabled` status during a drain
- Crop to: terminal window only

## 5. `grafana-dashboard.png`
- Used in: docs/observability.md
- What to capture: Grafana KubeLab dashboard showing at least: Pod Restarts, Pod Status, CPU Usage panels
- Crop to: dashboard panels only, no browser chrome

## 6. `architecture-diagram.png` (optional)
- Used in: docs/architecture.md (add manually if you create this)
- What to capture: Export the ASCII flow diagram as a proper diagram from Excalidraw or draw.io
- This one is optional — the text description in architecture.md is sufficient

