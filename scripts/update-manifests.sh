#!/bin/bash

# Update Kubernetes manifests with Docker Hub image names
# Usage: ./scripts/update-manifests.sh [dockerhub-username] [version]

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$SCRIPT_DIR/.."

DOCKERHUB_USERNAME=${1:-${DOCKERHUB_USER:-""}}
VERSION=${2:-"latest"}

if [ -z "$DOCKERHUB_USERNAME" ]; then
    echo "❌ Docker Hub username required"
    echo ""
    echo "Usage:"
    echo "  ./scripts/update-manifests.sh <dockerhub-username> [version]"
    echo ""
    exit 1
fi

BACKEND_IMAGE="$DOCKERHUB_USERNAME/kubelab-backend:$VERSION"
FRONTEND_IMAGE="$DOCKERHUB_USERNAME/kubelab-frontend:$VERSION"

echo "📝 Updating Kubernetes Manifests"
echo "=================================="
echo ""
echo "Backend image: $BACKEND_IMAGE"
echo "Frontend image: $FRONTEND_IMAGE"
echo ""

# Update backend manifest
BACKEND_MANIFEST="$PROJECT_ROOT/k8s/base/backend.yaml"
if [ -f "$BACKEND_MANIFEST" ]; then
    # Use sed to update the image (works on both macOS and Linux)
    if [[ "$OSTYPE" == "darwin"* ]]; then
        # macOS
        sed -i '' "s|image:.*kubelab/backend.*|image: $BACKEND_IMAGE|g" "$BACKEND_MANIFEST"
    else
        # Linux
        sed -i "s|image:.*kubelab/backend.*|image: $BACKEND_IMAGE|g" "$BACKEND_MANIFEST"
    fi
    echo "✅ Updated backend.yaml"
else
    echo "⚠️  backend.yaml not found"
fi

# Update frontend manifest
FRONTEND_MANIFEST="$PROJECT_ROOT/k8s/base/frontend.yaml"
if [ -f "$FRONTEND_MANIFEST" ]; then
    if [[ "$OSTYPE" == "darwin"* ]]; then
        # macOS
        sed -i '' "s|image:.*kubelab/frontend.*|image: $FRONTEND_IMAGE|g" "$FRONTEND_MANIFEST"
    else
        # Linux
        sed -i "s|image:.*kubelab/frontend.*|image: $FRONTEND_IMAGE|g" "$FRONTEND_MANIFEST"
    fi
    echo "✅ Updated frontend.yaml"
else
    echo "⚠️  frontend.yaml not found"
fi

echo ""
echo "✅ Manifests updated successfully"
echo ""
echo "📝 Verify the changes:"
echo "   git diff k8s/base/backend.yaml k8s/base/frontend.yaml"
echo ""

