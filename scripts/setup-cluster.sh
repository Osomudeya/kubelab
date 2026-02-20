#!/bin/bash

# Setup MicroK8s Multi-Node Cluster for KubeLab
# This script sets up MicroK8s on the control plane node
# Worker nodes should be joined using the output token

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

echo "🚀 KubeLab Cluster Setup"
echo "========================"
echo ""
echo "📚 What you're building:"
echo "   A 3-node Kubernetes cluster using MicroK8s"
echo "   - 1 Control Plane: runs the Kubernetes brain (API server, scheduler, controllers)"
echo "   - 2 Workers: run your application pods"
echo "   Why 3 nodes? So you can drain a worker node and watch pods migrate — that's the key lab exercise."
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

# Check if systemd is running (required for MicroK8s)
if ! systemctl is-system-running &> /dev/null; then
    echo "⚠️  Warning: systemd may not be running. MicroK8s requires systemd."
fi

# Check if MicroK8s is already installed
if command -v microk8s &> /dev/null; then
    echo "⚠️  MicroK8s is already installed"
    read -p "Do you want to reinstall? (y/N): " -n 1 -r
    echo
    if [[ ! $REPLY =~ ^[Yy]$ ]]; then
        echo "Skipping installation..."
    else
        echo "Removing existing MicroK8s installation..."
        sudo snap remove microk8s
    fi
fi

# Install MicroK8s
if ! command -v microk8s &> /dev/null; then
    echo "📚 Why this matters:"
    echo "   MicroK8s runs Kubernetes as a snap package — isolated, easy to install, and production-compatible."
    echo "   Version 1.28 is a stable release widely used in production environments."
    echo "   You get a real Kubernetes cluster, not a simulator."
    echo ""
    echo "📦 Step 1/5: Installing MicroK8s..."
    sudo snap install microk8s --classic --channel=1.28/stable
    echo "✅ MicroK8s installed"
    echo ""
    
    # Add user to microk8s group
    echo "📚 Why this matters:"
    echo "   Linux uses groups to control access to system resources."
    echo "   Adding your user to the 'microk8s' group lets you run kubectl without sudo."
    echo "   Without this, every kubectl command needs root privileges — which is inconvenient and insecure."
    echo ""
    echo "👤 Step 2/5: Configuring user permissions..."
    sudo usermod -a -G microk8s $USER
    sudo chown -f -R $USER ~/.kube || true
    echo "✅ User permissions configured"
    echo "⚠️  Note: You may need to log out and back in for group changes to take effect"
    echo ""
else
    echo "✅ MicroK8s already installed, skipping installation"
    echo ""
fi

# Wait for MicroK8s to be ready
echo "⏳ Waiting for MicroK8s to be ready..."
echo "   (MicroK8s starts several components: API server, etcd, scheduler, controller manager)"
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

# Enable required addons
echo "🔧 Step 3/5: Enabling MicroK8s addons..."
echo ""

echo "📚 Why this matters (DNS):"
echo "   Without DNS, pods can only find each other by IP address."
echo "   IP addresses change every time a pod restarts."
echo "   With DNS, the backend can connect to 'postgres' by name."
echo "   DNS is how Kubernetes service discovery works."
echo ""
microk8s enable dns
echo "✅ DNS enabled — pods can now find each other by name"
echo ""

echo "📚 Why this matters (Storage):"
echo "   Containers start with an empty filesystem — everything inside is temporary."
echo "   Persistent storage (PVCs) survives pod restarts, so your database data is safe."
echo "   Without storage, every PostgreSQL restart wipes your data."
echo "   The 'storage' addon creates a StorageClass that provisions volumes automatically."
echo ""
microk8s enable storage
echo "✅ Storage enabled — PostgreSQL can now persist data across restarts"
echo ""

echo "📚 Why this matters (Metrics Server):"
echo "   The metrics-server collects CPU and memory usage from all pods and nodes."
echo "   Without it, 'kubectl top pods' and 'kubectl top nodes' don't work."
echo "   It also enables Horizontal Pod Autoscaling (HPA) in production."
echo ""
microk8s enable metrics-server
echo "✅ Metrics server enabled — kubectl top pods/nodes now works"
echo ""

echo "✅ All addons enabled"
echo ""

# Configure kubectl alias
echo "📚 Why this matters (kubectl config):"
echo "   kubectl is the command-line tool for interacting with Kubernetes."
echo "   It needs a config file (~/.kube/config) with cluster credentials."
echo "   We're copying MicroK8s's credentials to the standard kubectl config location."
echo ""
echo "⚙️  Step 4/5: Configuring kubectl..."
if [ ! -f ~/.kube/config ]; then
    mkdir -p ~/.kube
    microk8s kubectl config view --raw > ~/.kube/config
    echo "✅ kubectl configured"
else
    echo "⚠️  ~/.kube/config already exists. Backing up to ~/.kube/config.backup"
    cp ~/.kube/config ~/.kube/config.backup
    microk8s kubectl config view --raw > ~/.kube/config
    echo "✅ kubectl configured (backup saved)"
fi
echo ""

# Verify cluster status
echo "🔍 Step 5/5: Verifying cluster status..."
sleep 5

NODES=$(kubectl get nodes --no-headers 2>/dev/null | wc -l || echo "0")
if [ "$NODES" -eq "0" ]; then
    echo "⚠️  No nodes found. This might be normal if MicroK8s is still initializing."
    echo "   Run 'kubectl get nodes' to check status"
else
    echo "✅ Cluster has $NODES node(s)"
    kubectl get nodes
fi
echo ""

# Generate join token for worker nodes
echo "📚 Why this matters (Join Token):"
echo "   Worker nodes don't automatically know about your control plane."
echo "   The join token is a one-time credential that lets worker nodes:"
echo "   1. Find the control plane address"
echo "   2. Authenticate to join the cluster"
echo "   3. Establish secure communication"
echo "   Tokens expire after use for security."
echo ""
echo "🔗 Generating join token for worker nodes..."
JOIN_TOKEN=$(microk8s add-node | grep -oP 'microk8s join \K[^ ]+' | head -1 || echo "")

if [ -n "$JOIN_TOKEN" ]; then
    echo ""
    echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
    echo "📋 WORKER NODE JOIN INSTRUCTIONS"
    echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
    echo ""
    echo "On each worker node, run:"
    echo ""
    echo "  Option 1: Use the join script (recommended):"
    echo "     git clone <repository-url>"
    echo "     cd kube-lab"
    echo "     chmod +x scripts/join-worker-node.sh"
    echo "     ./scripts/join-worker-node.sh $JOIN_TOKEN"
    echo ""
    echo "  Option 2: Manual join:"
    echo "     1. Install MicroK8s:"
    echo "        sudo snap install microk8s --classic --channel=1.28/stable"
    echo "     2. Add user to microk8s group:"
    echo "        sudo usermod -a -G microk8s \$USER"
    echo "        sudo chown -f -R \$USER ~/.kube"
    echo "     3. Join the cluster:"
    echo "        microk8s join $JOIN_TOKEN"
    echo ""
    echo "  4. Verify node joined (on control plane):"
    echo "     kubectl get nodes"
    echo ""
    echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
    echo ""
else
    echo "⚠️  Could not generate join token. Run 'microk8s add-node' manually to get the token."
fi

echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "🎓 What you just built:"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo ""
echo "   ✓ A Kubernetes control plane (the brain of the cluster)"
echo "   ✓ DNS for service discovery (pods find each other by name)"
echo "   ✓ Persistent storage (databases survive pod restarts)"
echo "   ✓ Metrics collection (kubectl top nodes/pods works)"
echo "   ✓ A join token for adding worker nodes"
echo ""
echo "🔍 Verify your cluster:"
echo "   kubectl get nodes         → Should show this control plane node as Ready"
echo "   kubectl get pods -A       → Should show system pods Running in kube-system"
echo "   kubectl cluster-info      → Should show API server address"
echo ""
echo "📝 Next Steps:"
echo "   1. Join worker nodes using the join instructions above (you need 2 worker nodes)"
echo "   2. Verify all nodes: kubectl get nodes (should show 3 nodes, all Ready)"
echo "   3. Deploy KubeLab: ./scripts/deploy-all.sh"
echo "   4. Open the dashboard: http://<any-node-ip>:30080"
echo ""
echo "📖 Open the dashboard: http://<node-ip>:30080 and run simulations from the UI."
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo ""
