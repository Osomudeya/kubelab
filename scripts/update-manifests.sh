#!/bin/bash

# Update Kubernetes manifests with Docker Hub image names
# Usage: ./scripts/update-manifests.sh [dockerhub-username] [version]

set -e

# Resolve script dir (works when run as bash script.sh or sh script.sh from any directory)
SCRIPT_PATH="${BASH_SOURCE[0]:-$0}"
SCRIPT_DIR="$(cd "$(dirname "$SCRIPT_PATH")" && pwd)"
PROJECT_ROOT="$SCRIPT_DIR/.."
cd "$PROJECT_ROOT"

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

# Update backend manifest (we cd'd to PROJECT_ROOT above)
BACKEND_MANIFEST="k8s/base/backend.yaml"
if [ -f "$BACKEND_MANIFEST" ]; then
    if [[ "$OSTYPE" == "darwin"* ]]; then
        sed -i '' "s|image:.*kubelab-backend.*|image: $BACKEND_IMAGE|g" "$BACKEND_MANIFEST"
    else
        sed -i "s|image:.*kubelab-backend.*|image: $BACKEND_IMAGE|g" "$BACKEND_MANIFEST"
    fi
    echo "✅ Updated backend.yaml"
else
    echo "⚠️  backend.yaml not found at $PROJECT_ROOT/$BACKEND_MANIFEST"
fi

# Update frontend manifest
FRONTEND_MANIFEST="k8s/base/frontend.yaml"
if [ -f "$FRONTEND_MANIFEST" ]; then
    if [[ "$OSTYPE" == "darwin"* ]]; then
        sed -i '' "s|image:.*kubelab-frontend.*|image: $FRONTEND_IMAGE|g" "$FRONTEND_MANIFEST"
    else
        sed -i "s|image:.*kubelab-frontend.*|image: $FRONTEND_IMAGE|g" "$FRONTEND_MANIFEST"
    fi
    echo "✅ Updated frontend.yaml"
else
    echo "⚠️  frontend.yaml not found at $PROJECT_ROOT/$FRONTEND_MANIFEST"
fi

echo ""
echo "✅ Manifests updated successfully"
echo ""
echo "📝 Verify the changes (run from repo root):"
echo "   git diff -- k8s/base/backend.yaml k8s/base/frontend.yaml"
echo ""

