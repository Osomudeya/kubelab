# Grafana Dashboards

This directory contains custom Grafana dashboards for KubeLab.

## Importing Dashboards

### Method 1: Via Grafana UI (Recommended)

1. Access Grafana at `http://<node-ip>:30300`
2. Login with credentials:
   - Username: `admin`
   - Password: `admin`
3. Navigate to **Dashboards** → **Import**
4. Click **Upload JSON file**
5. Select `cluster-health.json` from this directory
6. Click **Import**

### Method 2: Via kubectl port-forward

```bash
# Port forward to Grafana
kubectl port-forward -n kubelab svc/grafana 3000:3000

# Access at http://localhost:3000
```

Then follow steps 3-6 from Method 1.

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

1. Check Prometheus targets: `http://<node-ip>:<prometheus-port>/targets`
2. Verify all services are running: `kubectl get pods -n kubelab`
3. Check Prometheus datasource in Grafana: **Configuration** → **Data Sources**

