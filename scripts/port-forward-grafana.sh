#!/bin/bash

# Port-forward script for Grafana access
# Makes Grafana accessible at http://localhost:3000

set -e

echo "🔗 Setting up port-forward to Grafana..."
echo "   Access Grafana at: http://localhost:3000"
echo "   Default credentials: admin/admin"
echo ""
echo "   Press Ctrl+C to stop"
echo ""

kubectl port-forward -n kubelab svc/grafana 3000:3000

