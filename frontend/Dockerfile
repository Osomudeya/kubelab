# Multi-stage build for production-ready React frontend
FROM node:20-alpine AS builder

WORKDIR /app

# Copy package files
COPY package*.json ./

# Install dependencies
# Use npm install if package-lock.json doesn't exist, otherwise use npm ci
RUN if [ -f package-lock.json ]; then npm ci; else npm install; fi

# Copy source code
COPY . .

# Build the application
RUN npm run build

# Production stage with nginx
FROM nginx:alpine

# Create non-root user
RUN addgroup -g 1000 nginx-user && \
    adduser -D -u 1000 -G nginx-user nginx-user

# Copy custom nginx configuration
COPY nginx.conf /etc/nginx/nginx.conf

# Copy built files from builder
COPY --from=builder --chown=nginx-user:nginx-user /app/dist /usr/share/nginx/html

# Create nginx cache and pid directories with proper permissions
RUN mkdir -p /var/cache/nginx /var/log/nginx /var/run && \
    chown -R nginx-user:nginx-user /var/cache/nginx /var/log/nginx /var/run /usr/share/nginx/html /etc/nginx

# Switch to non-root user
USER nginx-user

# Expose port (non-root: 8080)
EXPOSE 8080

# Health check (nginx listens on 8080)
HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
  CMD wget --no-verbose --tries=1 --spider http://127.0.0.1:8080/health || exit 1

# Start nginx
CMD ["nginx", "-g", "daemon off;"]
