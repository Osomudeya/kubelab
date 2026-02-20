#!/bin/bash

# Deploy Complete KubeLab Stack
# Applies all manifests in the correct order with validation

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
K8S_DIR="$SCRIPT_DIR/../k8s"
BASE_DIR="$K8S_DIR/base"
SECURITY_DIR="$K8S_DIR/security"
OBSERVABILITY_DIR="$K8S_DIR/observability"

echo "🚀 Deploying KubeLab Stack"
echo "=========================="
echo ""

# Check if kubectl is available
if ! command -v kubectl &> /dev/null; then
    echo "❌ kubectl is not installed or not in PATH"
    echo "   Install kubectl: https://kubernetes.io/docs/tasks/tools/"
    echo "   Or if using MicroK8s: microk8s kubectl"
    exit 1
fi

# Check cluster connectivity
echo "🔍 Checking cluster connectivity..."
if ! kubectl cluster-info &> /dev/null; then
    echo "❌ Cannot connect to Kubernetes cluster"
    echo "   Ensure your kubeconfig is configured correctly"
    echo "   Try: kubectl cluster-info"
    echo "   Or if using MicroK8s: microk8s kubectl config view --raw > ~/.kube/config"
    exit 1
fi

# Check if cluster has nodes
NODE_COUNT=$(kubectl get nodes --no-headers 2>/dev/null | wc -l || echo "0")
if [ "$NODE_COUNT" -eq "0" ]; then
    echo "⚠️  Warning: No nodes found in cluster"
    echo "   This may be normal if the cluster is still initializing"
    read -p "Continue anyway? (y/N): " -n 1 -r
    echo
    if [[ ! $REPLY =~ ^[Yy]$ ]]; then
        exit 1
    fi
fi

# Check node count (recommend multi-node for best experience)
if [ "$NODE_COUNT" -lt "3" ]; then
    echo "⚠️  Warning: Less than 3 nodes detected ($NODE_COUNT node(s))"
    echo "   KubeLab is designed for a 3-node cluster (1 control-plane + 2 workers)"
    echo "   Some features work best with multiple worker nodes"
    echo "   Continue anyway? Pods will schedule on available nodes"
    read -p "Continue? (y/N): " -n 1 -r
    echo
    if [[ ! $REPLY =~ ^[Yy]$ ]]; then
        exit 1
    fi
fi

# Check if required manifests exist
if [ ! -d "$BASE_DIR" ] || [ ! -d "$SECURITY_DIR" ] || [ ! -d "$OBSERVABILITY_DIR" ]; then
    echo "❌ Required manifest directories not found"
    echo "   Expected: $BASE_DIR, $SECURITY_DIR, $OBSERVABILITY_DIR"
    exit 1
fi

echo "✅ Connected to cluster ($NODE_COUNT node(s))"
echo ""

# Function to wait for deployment
wait_for_deployment() {
    local namespace=$1
    local deployment=$2
    local timeout=${3:-120}
    
    echo "   ⏳ Waiting for $deployment to be ready (timeout: ${timeout}s)..."
    if kubectl wait --for=condition=available --timeout=${timeout}s deployment/$deployment -n $namespace &> /dev/null; then
        echo "   ✅ $deployment is ready"
        return 0
    else
        echo "   ⚠️  $deployment not ready within timeout (this may be normal for some resources)"
        return 1
    fi
}

# Function to wait for pods
wait_for_pods() {
    local namespace=$1
    local selector=$2
    local timeout=${3:-120}
    
    echo "   ⏳ Waiting for pods with selector '$selector' to be ready..."
    local elapsed=0
    while [ $elapsed -lt $timeout ]; do
        local ready=$(kubectl get pods -n $namespace -l $selector -o jsonpath='{.items[*].status.conditions[?(@.type=="Ready")].status}' 2>/dev/null | grep -o "True" | wc -l || echo "0")
        local total=$(kubectl get pods -n $namespace -l $selector --no-headers 2>/dev/null | wc -l || echo "0")
        
        if [ "$ready" -eq "$total" ] && [ "$total" -gt "0" ]; then
            echo "   ✅ All pods ready ($ready/$total)"
            return 0
        fi
        sleep 5
        elapsed=$((elapsed + 5))
    done
    echo "   ⚠️  Pods not all ready within timeout"
    return 1
}

# Step 1: Create namespace
echo "📦 Step 1/6: Creating namespace..."
kubectl apply -f "$BASE_DIR/namespace.yaml"
echo "✅ Namespace created"
echo ""

# Step 2: Apply secrets (must come before any workloads)
echo "🔑 Step 2/6: Applying secrets..."
SECRETS_FILE="$K8S_DIR/secrets.yaml"
if [ ! -f "$SECRETS_FILE" ]; then
    echo "❌ k8s/secrets.yaml not found."
    echo "   Copy the template and fill in your values:"
    echo "   cp k8s/secrets.yaml.example k8s/secrets.yaml"
    echo "   Then edit k8s/secrets.yaml with your passwords."
    exit 1
fi
kubectl apply -f "$SECRETS_FILE"
echo "✅ Secrets applied"
echo ""

# Step 3: Deploy security (RBAC, NetworkPolicy)
echo "🔒 Step 3/6: Deploying security configurations..."
kubectl apply -f "$SECURITY_DIR/rbac.yaml"
kubectl apply -f "$SECURITY_DIR/network-policies.yaml"
echo "✅ Security configurations deployed"
echo ""

# Step 4: Deploy base application (Postgres, Backend, Frontend)
echo "📦 Step 4/6: Deploying base application..."

echo "   Deploying PostgreSQL..."
kubectl apply -f "$BASE_DIR/postgres.yaml"
wait_for_pods "kubelab" "app=postgres" 180

echo "   Deploying Backend..."
kubectl apply -f "$BASE_DIR/backend.yaml"
wait_for_pods "kubelab" "app=backend" 120

echo "   Deploying Frontend..."
kubectl apply -f "$BASE_DIR/frontend.yaml"
wait_for_pods "kubelab" "app=frontend" 120

echo "✅ Base application deployed"
echo ""

# Step 5: Deploy observability stack
echo "📊 Step 5/6: Deploying observability stack..."

echo "   Deploying kube-state-metrics..."
kubectl apply -f "$OBSERVABILITY_DIR/kube-state-metrics.yaml"
wait_for_pods "kubelab" "app.kubernetes.io/name=kube-state-metrics" 120

echo "   Deploying node-exporter..."
kubectl apply -f "$OBSERVABILITY_DIR/node-exporter.yaml"
sleep 10  # DaemonSet needs a moment

echo "   Deploying Prometheus..."
kubectl apply -f "$OBSERVABILITY_DIR/prometheus.yaml"
wait_for_pods "kubelab" "app=prometheus" 180

echo "   Deploying Grafana..."
kubectl apply -f "$OBSERVABILITY_DIR/grafana.yaml"
wait_for_pods "kubelab" "app=grafana" 120

echo "✅ Observability stack deployed"
echo ""

# Step 6: Verification
echo "🔍 Step 6/6: Verifying deployment..."

echo ""
echo "📋 Pod Status:"
kubectl get pods -n kubelab

echo ""
echo "📋 Service Status:"
kubectl get svc -n kubelab

echo ""
echo "📋 Node Status:"
kubectl get nodes

echo ""
echo "✅ Deployment verification complete"
echo ""

# Get access information
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "🌐 ACCESS INFORMATION"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo ""

# Get node IP
NODE_IP=$(kubectl get nodes -o jsonpath='{.items[0].status.addresses[?(@.type=="InternalIP")].address}' 2>/dev/null || echo "localhost")

echo "📱 Frontend Dashboard:"
echo "   NodePort: http://$NODE_IP:30080"
echo "   Port-forward: kubectl port-forward -n kubelab svc/frontend 8080:80"
echo "   Then visit: http://localhost:8080"
echo ""

echo "📊 Grafana:"
echo "   NodePort: http://$NODE_IP:30300"
echo "   Port-forward: kubectl port-forward -n kubelab svc/grafana 3000:3000"
echo "   Then visit: http://localhost:3000"
echo "   Credentials: use the admin-user/admin-password from k8s/secrets.yaml"
echo ""

echo "📈 Prometheus:"
echo "   Port-forward: kubectl port-forward -n kubelab svc/prometheus 9090:9090"
echo "   Then visit: http://localhost:9090"
echo ""

echo "🔧 Backend API:"
echo "   Port-forward: kubectl port-forward -n kubelab svc/backend 3000:3000"
echo "   Health: http://localhost:3000/health"
echo "   Metrics: http://localhost:3000/metrics"
echo ""

echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo ""

echo "📝 Next Steps:"
echo "   1. Open the frontend and explore the cluster"
echo "   2. Open Grafana — dashboard and data source are auto-provisioned, no import needed"
echo "   3. Run smoke tests: ./scripts/smoke-test.sh"
echo "   4. Try failure simulations from the frontend (give Prometheus 2-3 min to scrape all targets)"
echo ""

echo "✅ KubeLab deployment complete!"
echo ""


