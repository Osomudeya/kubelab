# Grafana Dashboards

This directory contains custom Grafana dashboards for KubeLab. The **Cluster Health** dashboard and Prometheus data source are **auto-provisioned** when Grafana starts — no manual import needed for normal use.

## Accessing Grafana

**Recommended (port-forward):**
```bash
kubectl port-forward -n kubelab svc/grafana 3000:3000
```
Open http://localhost:3000 — login: `admin` / `kubelab-grafana-2026`.

**NodePort:** Open http://\<node-ip\>:30300 (same login).

## Manual import (optional)

If you need to re-import the dashboard:

1. Access Grafana (port-forward or NodePort above). Login: `admin` / `kubelab-grafana-2026`.
2. Go to **Dashboards** → **Import** → **Upload JSON file** → select `cluster-health.json` from this directory.

## Dashboard Overview

### Cluster Health Dashboard

The main dashboard (`cluster-health.json`) provides comprehensive monitoring of:

- **Top Row (Stats)**:
  - Nodes Ready: Number of ready nodes (green/red indicator)
  - Total Pods: Current pod count
  - Pod Restart Count: Total restarts in last hour

- **Middle Rows (Graphs)**:
  - Node CPU Usage: CPU utilization over time per node
  - Node Memory Usage: Memory utilization over time per node
  - Pod Restart Count Per Pod: Bar chart showing restarts by pod
  - Pods by Status: Pie chart (Running, Pending, Failed)

- **Bottom Rows (Application Metrics)**:
  - HTTP Request Rate: Requests per second from backend
  - Simulation Events Timeline: Total simulation events in last hour
  - Simulation Events by Type: Breakdown by event type

## Dashboard Features

- **Auto-refresh**: Updates every 10 seconds
- **Time range**: Defaults to last 1 hour
- **Color coding**:
  - Green: Healthy/Normal
  - Yellow: Warning
  - Red: Critical/Error

## Customization

To modify dashboards:

1. Export the dashboard from Grafana UI
2. Edit the JSON file
3. Re-import to apply changes

## Troubleshooting

If metrics don't appear:

1. Port-forward Prometheus: `kubectl port-forward -n kubelab svc/prometheus 9090:9090` then open http://localhost:9090/targets
2. Verify all services are running: `kubectl get pods -n kubelab`
3. In Grafana: **Connections** → **Data Sources** → Prometheus → **Save & Test**

