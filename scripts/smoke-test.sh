#!/bin/bash

# Smoke Tests for KubeLab
# Verifies all components are working correctly

set -eo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
NAMESPACE="kubelab"
PASSED=0
FAILED=0

echo "🧪 KubeLab Smoke Tests"
echo "======================"
echo ""

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# Function to print test result
print_result() {
    local test_name=$1
    local status=$2
    local message=$3
    
    if [ "$status" -eq 0 ]; then
        echo -e "${GREEN}✓ PASS${NC}: $test_name"
        if [ -n "$message" ]; then
            echo "  $message"
        fi
        PASSED=$((PASSED + 1))
    else
        echo -e "${RED}✗ FAIL${NC}: $test_name"
        if [ -n "$message" ]; then
            echo "  $message"
        fi
        FAILED=$((FAILED + 1))
    fi
    echo ""
}

# Test 1: Check namespace exists
echo "Test 1: Checking namespace..."
if kubectl get namespace $NAMESPACE &> /dev/null; then
    print_result "Namespace exists" 0 "Namespace '$NAMESPACE' found"
else
    print_result "Namespace exists" 1 "Namespace '$NAMESPACE' not found"
fi

# Test 2: Check all pods are Running
echo "Test 2: Checking pod status..."
NOT_RUNNING=$(kubectl get pods -n $NAMESPACE --no-headers 2>/dev/null | awk '!/Running|Completed/{c++} END{print c+0}')
TOTAL_PODS=$(kubectl get pods -n $NAMESPACE --no-headers 2>/dev/null | awk 'END{print NR}')

if [ "$NOT_RUNNING" -eq "0" ] && [ "$TOTAL_PODS" -gt "0" ]; then
    print_result "All pods running" 0 "All $TOTAL_PODS pods are in Running state"
else
    print_result "All pods running" 1 "$NOT_RUNNING pod(s) not running. Total: $TOTAL_PODS"
    echo "  Pod status:"
    kubectl get pods -n $NAMESPACE | head -10
fi

# Test 3: Check backend health endpoint
# Uses node (built into the backend image) instead of wget/curl
echo "Test 3: Checking backend health endpoint..."
BACKEND_POD=$(kubectl get pods -n $NAMESPACE -l app=backend -o jsonpath='{.items[0].metadata.name}' 2>/dev/null || echo "")

if [ -n "$BACKEND_POD" ]; then
    HEALTH_RESPONSE=$(kubectl exec -n $NAMESPACE $BACKEND_POD -- node -e \
        "require('http').get('http://localhost:3000/health',(r)=>{let d='';r.on('data',c=>d+=c);r.on('end',()=>process.stdout.write(d));}).on('error',()=>process.exit(1));" \
        2>/dev/null || echo "")
    if echo "$HEALTH_RESPONSE" | grep -q "healthy\|ok\|OK"; then
        print_result "Backend health check" 0 "Backend is healthy: $HEALTH_RESPONSE"
    else
        print_result "Backend health check" 1 "Backend health check failed (response: '$HEALTH_RESPONSE')"
    fi
else
    print_result "Backend health check" 1 "Backend pod not found"
fi

# Test 4: Check backend metrics endpoint
echo "Test 4: Checking backend metrics endpoint..."
if [ -n "$BACKEND_POD" ]; then
    METRICS_RESPONSE=$(kubectl exec -n $NAMESPACE $BACKEND_POD -- node -e \
        "require('http').get('http://localhost:3000/metrics',(r)=>{let d='';r.on('data',c=>d+=c);r.on('end',()=>process.stdout.write(d.split('\n').slice(0,5).join('\n')));}).on('error',()=>process.exit(1));" \
        2>/dev/null || echo "")
    if echo "$METRICS_RESPONSE" | grep -q "http_requests_total\|# HELP"; then
        print_result "Backend metrics endpoint" 0 "Prometheus metrics are exposed"
    else
        print_result "Backend metrics endpoint" 1 "Metrics endpoint not accessible (response: '$METRICS_RESPONSE')"
    fi
else
    print_result "Backend metrics endpoint" 1 "Backend pod not found"
fi

# Test 5: Check frontend service
echo "Test 5: Checking frontend service..."
FRONTEND_SVC=$(kubectl get svc -n $NAMESPACE -l app=frontend -o jsonpath='{.items[0].metadata.name}' 2>/dev/null || echo "")
if [ -n "$FRONTEND_SVC" ]; then
    FRONTEND_PORT=$(kubectl get svc -n $NAMESPACE $FRONTEND_SVC -o jsonpath='{.spec.ports[0].nodePort}' 2>/dev/null || echo "")
    if [ -n "$FRONTEND_PORT" ]; then
        print_result "Frontend service" 0 "Frontend service accessible on NodePort $FRONTEND_PORT"
    else
        print_result "Frontend service" 1 "Frontend service found but NodePort not configured"
    fi
else
    print_result "Frontend service" 1 "Frontend service not found"
fi

# Test 6: Check Prometheus targets
echo "Test 6: Checking Prometheus targets..."
PROMETHEUS_POD=$(kubectl get pods -n $NAMESPACE -l app=prometheus -o jsonpath='{.items[0].metadata.name}' 2>/dev/null || echo "")
if [ -n "$PROMETHEUS_POD" ]; then
    # Wait a bit for Prometheus to scrape
    sleep 5
    TARGETS_UP=$(kubectl exec -n $NAMESPACE $PROMETHEUS_POD -- wget -qO- http://localhost:9090/api/v1/targets 2>/dev/null | grep -o '"health":"up"' | awk 'END{print NR}')
    if [ "$TARGETS_UP" -gt "0" ]; then
        print_result "Prometheus targets" 0 "$TARGETS_UP target(s) are UP"
    else
        print_result "Prometheus targets" 1 "No Prometheus targets are UP"
    fi
else
    print_result "Prometheus targets" 1 "Prometheus pod not found"
fi

# Test 7: Check Grafana
echo "Test 7: Checking Grafana..."
GRAFANA_POD=$(kubectl get pods -n $NAMESPACE -l app=grafana -o jsonpath='{.items[0].metadata.name}' 2>/dev/null || echo "")
if [ -n "$GRAFANA_POD" ]; then
    GRAFANA_HEALTH=$(kubectl exec -n $NAMESPACE $GRAFANA_POD -- wget -qO- http://localhost:3000/api/health 2>/dev/null || echo "")
    if echo "$GRAFANA_HEALTH" | grep -q "database\|OK"; then
        print_result "Grafana health" 0 "Grafana is healthy"
    else
        print_result "Grafana health" 1 "Grafana health check failed"
    fi
else
    print_result "Grafana health" 1 "Grafana pod not found"
fi

# Test 8: Test simulation endpoint (cluster/status via backend)
# Uses node exec inside the backend pod - no extra images or NetworkPolicy issues
echo "Test 8: Testing cluster status endpoint..."
if [ -n "$BACKEND_POD" ]; then
    STATUS_RESPONSE=$(kubectl exec -n $NAMESPACE $BACKEND_POD -- node -e \
        "require('http').get('http://localhost:3000/api/cluster/status',(r)=>{let d='';r.on('data',c=>d+=c);r.on('end',()=>{const j=JSON.parse(d);process.stdout.write('pods:'+j.data.summary.totalPods+' nodes:'+j.data.summary.totalNodes);});}).on('error',e=>{process.stderr.write(e.message);process.exit(1);});" \
        2>/dev/null || echo "")
    if echo "$STATUS_RESPONSE" | grep -q "pods:\|nodes:"; then
        print_result "Cluster status API" 0 "$STATUS_RESPONSE"
    else
        print_result "Cluster status API" 1 "Unexpected response: '$STATUS_RESPONSE'"
    fi
else
    print_result "Cluster status API" 1 "Backend pod not found"
fi

# Summary
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "📊 Test Summary"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo ""
echo -e "${GREEN}Passed: $PASSED${NC}"
echo -e "${RED}Failed: $FAILED${NC}"
echo ""

if [ $FAILED -eq 0 ]; then
    echo -e "${GREEN}✅ All tests passed!${NC}"
    echo ""
    exit 0
else
    echo -e "${YELLOW}⚠️  Some tests failed. Please check the output above.${NC}"
    echo ""
    exit 1
fi

