#!/bin/bash

# Join Worker Node to MicroK8s Cluster
# Optional shortcut. First time? Follow the join steps in setup/k8s-cluster-setup.md (Part 4).
# Run this on each worker VM after getting the join token from the control plane.

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

echo "🔗 Joining Worker Node to MicroK8s Cluster"
echo "==========================================="
echo ""

# Check if running as root
if [ "$EUID" -eq 0 ]; then 
   echo "❌ Please do not run this script as root"
   exit 1
fi

# Check if snap is available
if ! command -v snap &> /dev/null; then
    echo "❌ snap is not installed"
    echo "   Install snap: sudo apt install snapd (Ubuntu/Debian)"
    echo "   Or use: sudo yum install snapd (RHEL/CentOS)"
    exit 1
fi

# Check if MicroK8s is already installed
if ! command -v microk8s &> /dev/null; then
    echo "📦 Installing MicroK8s..."
    sudo snap install microk8s --classic --channel=1.28/stable
    echo "✅ MicroK8s installed"
    echo ""
    
    # Add user to microk8s group
    echo "👤 Configuring user permissions..."
    sudo usermod -a -G microk8s $USER
    sudo chown -f -R $USER ~/.kube || true
    echo "✅ User permissions configured"
    echo "⚠️  Note: You may need to log out and back in for group changes to take effect"
    echo "   Or run: newgrp microk8s"
    echo ""
else
    echo "✅ MicroK8s already installed"
    echo ""
fi

# Wait for MicroK8s to be ready
echo "⏳ Waiting for MicroK8s to be ready..."
timeout=300
elapsed=0
while ! microk8s status --wait-ready &> /dev/null; do
    if [ $elapsed -ge $timeout ]; then
        echo "❌ Timeout waiting for MicroK8s to be ready"
        exit 1
    fi
    sleep 5
    elapsed=$((elapsed + 5))
    echo "   Still waiting... (${elapsed}s)"
done
echo "✅ MicroK8s is ready"
echo ""

# Get join token from user
if [ -z "$1" ]; then
    echo "📋 To join this worker node to the cluster, you need a join token."
    echo ""
    echo "On the CONTROL PLANE node, run:"
    echo "   microk8s add-node"
    echo ""
    echo "Then copy the join command (it will look like):"
    echo "   microk8s join <token>"
    echo ""
    read -p "Enter the join token (or full join command): " JOIN_TOKEN
    echo ""
else
    JOIN_TOKEN="$1"
fi

# Extract token if full command provided
if [[ "$JOIN_TOKEN" == *"microk8s join"* ]]; then
    JOIN_TOKEN=$(echo "$JOIN_TOKEN" | sed 's/.*microk8s join //')
fi

if [ -z "$JOIN_TOKEN" ]; then
    echo "❌ Join token is required"
    exit 1
fi

# Join the cluster
echo "🔗 Joining cluster with token..."
if microk8s join "$JOIN_TOKEN"; then
    echo "✅ Successfully joined the cluster!"
    echo ""
    
    # Wait a moment for the node to register
    echo "⏳ Waiting for node to register..."
    sleep 10
    
    # Verify on control plane (if kubectl is configured)
    echo ""
    echo "📋 To verify this node joined successfully, on the CONTROL PLANE node run:"
    echo "   kubectl get nodes"
    echo ""
    echo "You should see this node listed as Ready."
    echo ""
else
    echo "❌ Failed to join cluster"
    echo ""
    echo "Troubleshooting:"
    echo "  1. Ensure the token is still valid (tokens expire after a few minutes)"
    echo "  2. Check network connectivity to the control plane node"
    echo "  3. Verify MicroK8s is running on the control plane"
    echo "  4. Get a new token from the control plane: microk8s add-node"
    exit 1
fi

echo "✅ Worker node setup complete!"
echo ""

