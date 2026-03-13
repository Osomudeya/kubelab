# Docker Hub Setup Guide

Build and push KubeLab images to Docker Hub in 3 steps.

## Prerequisites

- Docker Desktop running
- Docker Hub account (sign up at https://hub.docker.com)
- Logged in: `docker login`

## Quick Start

```bash
# 1. Build and push both images
./scripts/build-and-push.sh <your-dockerhub-username>

# When prompted "Push images to Docker Hub? (y/N):" type y and Enter.
# If the script seems stuck, it is waiting for that input. Use -y to skip the prompt:
./scripts/build-and-push.sh <your-dockerhub-username> latest -y

# 2. Update Kubernetes manifests
./scripts/update-manifests.sh <your-dockerhub-username>

# 3. Deploy (images will pull from Docker Hub)
./scripts/deploy-all.sh
```

That's it! Your images are now on Docker Hub and ready to use.

## What Gets Built

- **Backend**: `your-username/kubelab-backend:latest` (~53MB)
- **Frontend**: `your-username/kubelab-frontend:latest` (~26MB)

Both images are production-ready: non-root users, health checks, optimized sizes.

## Manual Build (Alternative)

If you prefer manual steps:

```bash
# Build
cd backend && docker build -t <username>/kubelab-backend:latest .
cd ../frontend && docker build -t <username>/kubelab-frontend:latest .

# Push
docker push <username>/kubelab-backend:15
docker push <username>/kubelab-frontend:15
```

## Verify

```bash
# Check local images
docker images | grep kubelab

# Check on Docker Hub
# Visit: https://hub.docker.com/r/<your-username>/kubelab-backend
```

## Docker Compose Testing

After building images, test them locally with Docker Compose:

```bash
# Start all services
docker-compose up -d

# Check status
docker-compose ps

# View logs
docker-compose logs -f

# Stop services
docker-compose down
```

**Access Points:**
- Frontend: http://localhost:8080
- Backend: http://localhost:3000
- PostgreSQL: localhost:5433

**Note**: When running in Docker Compose, the backend will return mock data since Kubernetes API is not available. This is expected behavior. Deploy to Kubernetes to see real cluster data.

## Troubleshooting

**Build-and-push script seems stuck after "Building frontend image..."?**
- The script waits for you to type `y` and Enter at "Push images to Docker Hub? (y/N):". In some terminals (IDE run button, no TTY) that prompt never appears and the script just hangs.
- **Fix:** Run with `-y` to push without prompting: `./scripts/build-and-push.sh <username> latest -y`
- Or run in a normal terminal and type `y` when asked.

**Build fails with "npm ci" error?**
- Dockerfiles handle missing `package-lock.json` automatically. If issues persist, run `npm install` in backend/ and frontend/ directories first.

**Push fails?**
- Make sure you're logged in: `docker login`
- Verify username: `docker info | grep Username`

**Docker not running?**
- Start Docker Desktop and wait for it to fully start.

**UI shows "Kubernetes API not available" in Docker Compose?**
- This is normal! The backend gracefully handles missing Kubernetes API by returning mock data. Deploy to Kubernetes to see real cluster data.

**Port 5432 already in use?**
- Docker Compose uses port 5433 for PostgreSQL to avoid conflicts. If you need to change it, edit `docker-compose.yml`.

## Current Status

✅ **Images on Docker Hub**:
- `veeno/kubelab-backend:15`
- `veeno/kubelab-frontend:15`

✅ **Manifests Updated**:
- `k8s/base/backend.yaml` → Uses Docker Hub images
- `k8s/base/frontend.yaml` → Uses Docker Hub images

---

**Note**: Replace `veeno` with your Docker Hub username in examples.
