#!/bin/bash

# Deploy KubeLab to MicroK8s
# Uses microk8s kubectl directly

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
K8S_DIR="$SCRIPT_DIR/../k8s"

echo "🚀 Deploying KubeLab to MicroK8s"
echo "=================================="
echo ""

# Use kubectl if it can reach a cluster (e.g. context microk8s); else use microk8s kubectl
if kubectl get nodes &>/dev/null; then
    KUBECTL="kubectl"
    echo "✅ Using kubectl ($(kubectl config current-context 2>/dev/null || echo 'current context'))"
elif command -v microk8s &>/dev/null && microk8s status 2>/dev/null | grep -q "is running" && microk8s kubectl get nodes &>/dev/null; then
    KUBECTL="microk8s kubectl"
    echo "✅ Using microk8s kubectl"
else
    echo "❌ Cannot reach cluster. Run: kubectl config use-context microk8s"
    echo "   Then: kubectl get nodes   (should list your MicroK8s nodes)"
    exit 1
fi
echo ""

# Deploy namespace
echo "📦 Creating namespace..."
$KUBECTL apply -f "$K8S_DIR/base/namespace.yaml"

# Deploy security
echo "🔒 Deploying security..."
$KUBECTL apply -f "$K8S_DIR/security/rbac.yaml"
$KUBECTL apply -f "$K8S_DIR/security/network-policies.yaml"

# Deploy base app
echo "📦 Deploying base application..."
$KUBECTL apply -f "$K8S_DIR/base/postgres.yaml"
$KUBECTL apply -f "$K8S_DIR/base/backend.yaml"
$KUBECTL apply -f "$K8S_DIR/base/frontend.yaml"

# Deploy observability
echo "📊 Deploying observability..."
$KUBECTL apply -f "$K8S_DIR/observability/kube-state-metrics.yaml"
$KUBECTL apply -f "$K8S_DIR/observability/node-exporter.yaml"
$KUBECTL apply -f "$K8S_DIR/observability/prometheus.yaml"
$KUBECTL apply -f "$K8S_DIR/observability/grafana.yaml"

echo ""
echo "⏳ Waiting for pods to be ready..."
sleep 10

echo ""
echo "📋 Pod Status:"
$KUBECTL get pods -n kubelab

echo ""
echo "✅ Deployment complete!"
echo ""
echo "🌐 Access:"
NODE_IP=$($KUBECTL get nodes -o jsonpath='{.items[0].status.addresses[?(@.type=="InternalIP")].address}' 2>/dev/null || echo "localhost")
echo "   Frontend: http://$NODE_IP:30080"
echo "   Grafana:  http://$NODE_IP:30300 (admin / kubelab-grafana-2026)"
