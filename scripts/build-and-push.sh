#!/bin/bash

# Build and push KubeLab Docker images to Docker Hub
# Usage: ./scripts/build-and-push.sh [dockerhub-username] [version]

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$SCRIPT_DIR/.."
PLATFORMS="${PLATFORMS:-linux/amd64,linux/arm64}"
BUILDER_NAME="${BUILDER_NAME:-kubelab-multiarch}"

# Parse args: [username] [version] or -y/--yes to skip push prompt
DOCKERHUB_USERNAME=""
VERSION="latest"
AUTO_PUSH=""
for arg in "$@"; do
    if [ "$arg" = "-y" ] || [ "$arg" = "--yes" ]; then
        AUTO_PUSH=1
    elif [ -z "$DOCKERHUB_USERNAME" ]; then
        DOCKERHUB_USERNAME="$arg"
    elif [ "$VERSION" = "latest" ] && [ "$arg" != "latest" ]; then
        VERSION="$arg"
    fi
done
DOCKERHUB_USERNAME=${DOCKERHUB_USERNAME:-${DOCKERHUB_USER:-""}}

if [ -z "$DOCKERHUB_USERNAME" ]; then
    echo "❌ Docker Hub username required"
    echo ""
    echo "Usage:"
    echo "  ./scripts/build-and-push.sh <dockerhub-username> [version] [-y]"
    echo "  -y / --yes   Push without prompting (use when terminal has no TTY or script runs non-interactively)"
    echo ""
    echo "Or set environment variable:"
    echo "  export DOCKERHUB_USER=your-username"
    echo "  ./scripts/build-and-push.sh -y"
    echo ""
    exit 1
fi

# Check if Docker is running
if ! docker info &> /dev/null; then
    echo "❌ Docker is not running. Please start Docker and try again."
    exit 1
fi

# Check if Docker buildx is available
if ! docker buildx version &> /dev/null; then
    echo "❌ Docker buildx is required for multi-architecture builds."
    echo "   Install or enable Docker Buildx and try again."
    exit 1
fi

# Check if Docker Hub credentials are present in the local Docker config.
# `docker info | grep Username` is not reliable across Docker versions.
if ! grep -q '"https://index.docker.io/v1/"' "${DOCKER_CONFIG:-$HOME/.docker}/config.json" 2>/dev/null; then
    echo "⚠️  Docker Hub login not detected in ${DOCKER_CONFIG:-$HOME/.docker}/config.json"
    echo "   Run: docker login"
    echo "   Then run this script again"
    exit 1
fi

# Create or reuse a buildx builder that can publish a multi-arch manifest.
if ! docker buildx inspect "$BUILDER_NAME" &> /dev/null; then
    docker buildx create --name "$BUILDER_NAME" --driver docker-container --use
else
    docker buildx use "$BUILDER_NAME"
fi

docker buildx inspect --bootstrap > /dev/null

echo "🐳 Building and Pushing KubeLab Images"
echo "======================================="
echo ""
echo "Docker Hub Username: $DOCKERHUB_USERNAME"
echo "Version Tag: $VERSION"
echo "Platforms: $PLATFORMS"
echo ""

BACKEND_IMAGE="$DOCKERHUB_USERNAME/kubelab-backend"
FRONTEND_IMAGE="$DOCKERHUB_USERNAME/kubelab-frontend"

# Confirm push unless -y/--yes
if [ -z "$AUTO_PUSH" ]; then
    echo ""
    read -p "Push images to Docker Hub? (y/N): " -n 1 -r
    echo
    if [[ ! $REPLY =~ ^[Yy]$ ]]; then
        echo "Build complete. Images are ready but not pushed."
        echo ""
        echo "To build and push manually:"
        echo "  docker buildx build --platform $PLATFORMS -t $BACKEND_IMAGE:$VERSION -t $BACKEND_IMAGE:latest --push $PROJECT_ROOT/backend"
        echo "  docker buildx build --platform $PLATFORMS -t $FRONTEND_IMAGE:$VERSION -t $FRONTEND_IMAGE:latest --push $PROJECT_ROOT/frontend"
        exit 0
    fi
fi

# Build and push backend
echo ""
echo "📦 Building and pushing backend image..."
docker buildx build \
    --platform "$PLATFORMS" \
    -t "$BACKEND_IMAGE:$VERSION" \
    -t "$BACKEND_IMAGE:latest" \
    --push \
    "$PROJECT_ROOT/backend"
echo "✅ Backend multi-arch image pushed successfully"

# Build and push frontend
echo ""
echo "📦 Building and pushing frontend image..."
docker buildx build \
    --platform "$PLATFORMS" \
    -t "$FRONTEND_IMAGE:$VERSION" \
    -t "$FRONTEND_IMAGE:latest" \
    --push \
    "$PROJECT_ROOT/frontend"
echo "✅ Frontend multi-arch image pushed successfully"

echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "✅ Build and Push Complete!"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo ""
echo "📦 Multi-arch images pushed to Docker Hub:"
echo "   - $BACKEND_IMAGE:$VERSION"
echo "   - $BACKEND_IMAGE:latest"
echo "   - $FRONTEND_IMAGE:$VERSION"
echo "   - $FRONTEND_IMAGE:latest"
echo ""
echo "📝 Next Steps:"
echo "   1. Update k8s/base/backend.yaml with: $BACKEND_IMAGE:latest"
echo "   2. Update k8s/base/frontend.yaml with: $FRONTEND_IMAGE:latest"
echo "   3. Or use the update-manifests.sh script to update automatically"
echo ""
