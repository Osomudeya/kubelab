#!/bin/bash

# Test KubeLab locally using Docker Compose
# This allows you to test the full stack before deploying to Kubernetes

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$SCRIPT_DIR/.."

echo "🧪 Testing KubeLab Locally with Docker Compose"
echo "=============================================="
echo ""

# Check if Docker is running
if ! docker info &> /dev/null; then
    echo "❌ Docker is not running. Please start Docker Desktop first."
    exit 1
fi

# Check if docker-compose is available
if ! command -v docker-compose &> /dev/null && ! docker compose version &> /dev/null; then
    echo "❌ docker-compose is not installed"
    echo "   Install it or use Docker Desktop which includes compose"
    exit 1
fi

# Determine compose command
if docker compose version &> /dev/null; then
    COMPOSE_CMD="docker compose"
else
    COMPOSE_CMD="docker-compose"
fi

cd "$PROJECT_ROOT"

echo "📦 Starting services..."
$COMPOSE_CMD up -d

echo ""
echo "⏳ Waiting for services to be healthy..."
sleep 10

# Check service health
echo ""
echo "🔍 Checking service health..."

# Check backend
if curl -s http://localhost:3000/health | grep -q "healthy"; then
    echo "✅ Backend is healthy"
else
    echo "⚠️  Backend health check failed (may still be starting)"
fi

# Check frontend
if curl -s http://localhost:8080/health &> /dev/null; then
    echo "✅ Frontend is healthy"
else
    echo "⚠️  Frontend health check failed (may still be starting)"
fi

# Check postgres
if $COMPOSE_CMD exec -T postgres pg_isready -U kubelab &> /dev/null; then
    echo "✅ PostgreSQL is healthy"
else
    echo "⚠️  PostgreSQL health check failed"
fi

echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "✅ Services Started!"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo ""
echo "🌐 Access Points:"
echo "   Frontend: http://localhost:8080"
echo "   Backend API: http://localhost:3000"
echo "   Backend Health: http://localhost:3000/health"
echo "   Backend Metrics: http://localhost:3000/metrics"
echo "   PostgreSQL: localhost:5432"
echo ""
echo "📋 Useful Commands:"
echo "   View logs:        $COMPOSE_CMD logs -f"
echo "   Stop services:    $COMPOSE_CMD down"
echo "   Stop & remove:    $COMPOSE_CMD down -v"
echo "   Restart:          $COMPOSE_CMD restart"
echo ""
echo "🧪 Test Backend API:"
echo "   curl http://localhost:3000/health"
echo "   curl http://localhost:3000/api/cluster/status"
echo ""

