# Multi-stage build for production-ready Node.js backend
FROM node:20-alpine AS builder

# Set working directory
WORKDIR /app

# Copy package files
COPY package*.json ./

# Install all dependencies (needed for runtime)
# Use npm install if package-lock.json doesn't exist, otherwise use npm ci
RUN if [ -f package-lock.json ]; then npm ci; else npm install; fi && npm cache clean --force

# Production stage
FROM node:20-alpine

# Use existing node user (already exists in node:20-alpine)
# Verify user exists, create if it doesn't
RUN id -u node &>/dev/null || (addgroup -g 1000 node && adduser -D -u 1000 -G node node)

# Set working directory
WORKDIR /app

# Copy dependencies from builder
COPY --from=builder --chown=node:node /app/node_modules ./node_modules

# Copy application code
COPY --chown=node:node . .

# Switch to non-root user
USER node

# Expose port
EXPOSE 3000

# Health check
HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
  CMD node -e "require('http').get('http://localhost:3000/health', (r) => {process.exit(r.statusCode === 200 ? 0 : 1)})"

# Start the application
CMD ["node", "src/server.js"]
