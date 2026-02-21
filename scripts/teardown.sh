#!/bin/bash

# Teardown KubeLab Stack
# Nuclear option: wipe everything and start over
# Use this when something is broken and you want a clean slate

set -e

echo "⚠️  KubeLab Teardown"
echo "==================="
echo ""
echo "This will delete:"
echo "  • The entire 'kubelab' namespace (all pods, services, PVCs, etc.)"
echo "  • The 'kubelab-backend-binding' ClusterRoleBinding"
echo ""
echo "⚠️  This is destructive. All data in the kubelab namespace will be lost."
echo ""

read -p "Continue? (y/N): " -n 1 -r
echo
if [[ ! $REPLY =~ ^[Yy]$ ]]; then
    echo "Cancelled."
    exit 0
fi

echo ""
echo "🗑️  Deleting kubelab namespace..."
kubectl delete namespace kubelab --ignore-not-found=true || true

echo "🗑️  Deleting ClusterRoleBinding..."
kubectl delete clusterrolebinding kubelab-backend-binding --ignore-not-found=true || true

echo ""
echo "✅ Clean slate achieved."
echo ""
echo "Next steps:"
echo "  • Run ./scripts/deploy-all.sh to start fresh"
echo ""

