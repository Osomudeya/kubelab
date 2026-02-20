#!/bin/bash

# Deploy Observability Stack for KubeLab
# This script applies all observability manifests in the correct order

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
K8S_DIR="$SCRIPT_DIR/../k8s"
OBSERVABILITY_DIR="$K8S_DIR/observability"

echo "🚀 Deploying KubeLab Observability Stack..."
echo ""

# Check if kubectl is available
if ! command -v kubectl &> /dev/null; then
    echo "❌ kubectl is not installed or not in PATH"
    exit 1
fi

# Check if namespace exists
if ! kubectl get namespace kubelab &> /dev/null; then
    echo "⚠️  Namespace 'kubelab' does not exist. Creating it..."
    kubectl apply -f "$K8S_DIR/base/namespace.yaml"
fi

echo "📦 Step 1/5: Deploying kube-state-metrics..."
kubectl apply -f "$OBSERVABILITY_DIR/kube-state-metrics.yaml"
echo "✅ kube-state-metrics deployed"
echo ""

echo "📦 Step 2/5: Deploying node-exporter..."
kubectl apply -f "$OBSERVABILITY_DIR/node-exporter.yaml"
echo "✅ node-exporter deployed"
echo ""

echo "📦 Step 3/5: Deploying Prometheus..."
kubectl apply -f "$OBSERVABILITY_DIR/prometheus.yaml"
echo "✅ Prometheus deployed"
echo ""

echo "⏳ Waiting for Prometheus to be ready..."
kubectl wait --for=condition=available --timeout=120s deployment/prometheus -n kubelab || true
echo ""

echo "📦 Step 4/5: Deploying Grafana..."
kubectl apply -f "$OBSERVABILITY_DIR/grafana.yaml"
echo "✅ Grafana deployed"
echo ""

echo "⏳ Waiting for Grafana to be ready..."
kubectl wait --for=condition=available --timeout=120s deployment/grafana -n kubelab || true
echo ""

echo "✅ Observability stack deployment complete!"
echo ""
echo "📊 Access Information:"
echo "   Prometheus: kubectl port-forward -n kubelab svc/prometheus 9090:9090"
echo "   Grafana:   kubectl port-forward -n kubelab svc/grafana 3000:3000"
echo "              Or access via NodePort: http://<node-ip>:30300"
echo ""
echo "🔐 Grafana Default Credentials:"
echo "   Username: admin"
echo "   Password: admin"
echo ""
echo "📈 Next Steps:"
echo "   1. Import dashboard: k8s/observability/dashboards/cluster-health.json"
echo "   2. Check Prometheus targets: http://localhost:9090/targets"
echo "   3. Verify metrics are being collected"
echo ""

