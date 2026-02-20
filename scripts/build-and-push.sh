#!/bin/bash

# Build and push KubeLab Docker images to Docker Hub
# Usage: ./scripts/build-and-push.sh [dockerhub-username] [version]

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$SCRIPT_DIR/.."

# Get Docker Hub username
DOCKERHUB_USERNAME=${1:-${DOCKERHUB_USER:-""}}
VERSION=${2:-"latest"}

if [ -z "$DOCKERHUB_USERNAME" ]; then
    echo "❌ Docker Hub username required"
    echo ""
    echo "Usage:"
    echo "  ./scripts/build-and-push.sh <dockerhub-username> [version]"
    echo ""
    echo "Or set environment variable:"
    echo "  export DOCKERHUB_USER=your-username"
    echo "  ./scripts/build-and-push.sh"
    echo ""
    exit 1
fi

# Check if Docker is running
if ! docker info &> /dev/null; then
    echo "❌ Docker is not running. Please start Docker and try again."
    exit 1
fi

# Check if logged in to Docker Hub
if ! docker info | grep -q "Username"; then
    echo "⚠️  Not logged in to Docker Hub"
    echo "   Run: docker login"
    echo "   Then run this script again"
    exit 1
fi

echo "🐳 Building and Pushing KubeLab Images"
echo "======================================="
echo ""
echo "Docker Hub Username: $DOCKERHUB_USERNAME"
echo "Version Tag: $VERSION"
echo ""

# Build backend
echo "📦 Building backend image..."
cd "$PROJECT_ROOT/backend"
docker build -t "$DOCKERHUB_USERNAME/kubelab-backend:$VERSION" \
             -t "$DOCKERHUB_USERNAME/kubelab-backend:latest" \
             .

if [ $? -eq 0 ]; then
    echo "✅ Backend image built successfully"
else
    echo "❌ Backend build failed"
    exit 1
fi

# Build frontend
echo ""
echo "📦 Building frontend image..."
cd "$PROJECT_ROOT/frontend"
docker build -t "$DOCKERHUB_USERNAME/kubelab-frontend:$VERSION" \
             -t "$DOCKERHUB_USERNAME/kubelab-frontend:latest" \
             .

if [ $? -eq 0 ]; then
    echo "✅ Frontend image built successfully"
else
    echo "❌ Frontend build failed"
    exit 1
fi

# Show image sizes
echo ""
echo "📊 Image Sizes:"
docker images | grep "$DOCKERHUB_USERNAME/kubelab" | head -2

# Ask for confirmation before pushing
echo ""
read -p "Push images to Docker Hub? (y/N): " -n 1 -r
echo
if [[ ! $REPLY =~ ^[Yy]$ ]]; then
    echo "Build complete. Images are ready but not pushed."
    echo ""
    echo "To push manually:"
    echo "  docker push $DOCKERHUB_USERNAME/kubelab-backend:$VERSION"
    echo "  docker push $DOCKERHUB_USERNAME/kubelab-backend:latest"
    echo "  docker push $DOCKERHUB_USERNAME/kubelab-frontend:$VERSION"
    echo "  docker push $DOCKERHUB_USERNAME/kubelab-frontend:latest"
    exit 0
fi

# Push backend
echo ""
echo "🚀 Pushing backend image..."
docker push "$DOCKERHUB_USERNAME/kubelab-backend:$VERSION"
docker push "$DOCKERHUB_USERNAME/kubelab-backend:latest"

if [ $? -eq 0 ]; then
    echo "✅ Backend image pushed successfully"
else
    echo "❌ Backend push failed"
    exit 1
fi

# Push frontend
echo ""
echo "🚀 Pushing frontend image..."
docker push "$DOCKERHUB_USERNAME/kubelab-frontend:$VERSION"
docker push "$DOCKERHUB_USERNAME/kubelab-frontend:latest"

if [ $? -eq 0 ]; then
    echo "✅ Frontend image pushed successfully"
else
    echo "❌ Frontend push failed"
    exit 1
fi

echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "✅ Build and Push Complete!"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo ""
echo "📦 Images pushed to Docker Hub:"
echo "   - $DOCKERHUB_USERNAME/kubelab-backend:$VERSION"
echo "   - $DOCKERHUB_USERNAME/kubelab-backend:latest"
echo "   - $DOCKERHUB_USERNAME/kubelab-frontend:$VERSION"
echo "   - $DOCKERHUB_USERNAME/kubelab-frontend:latest"
echo ""
echo "📝 Next Steps:"
echo "   1. Update k8s/base/backend.yaml with: $DOCKERHUB_USERNAME/kubelab-backend:latest"
echo "   2. Update k8s/base/frontend.yaml with: $DOCKERHUB_USERNAME/kubelab-frontend:latest"
echo "   3. Or use the update-manifests.sh script to update automatically"
echo ""

