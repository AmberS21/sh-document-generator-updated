# ── Stage 1: Build Node.js backend dependencies ──────────────────────────────
FROM public.ecr.aws/docker/library/node:18-alpine AS backend-build
WORKDIR /app/backend
COPY backend/package.json ./
RUN npm install --production

# ── Stage 2: Final image — nginx (frontend) + Node.js (backend) ──────────────
FROM public.ecr.aws/docker/library/nginx:1.27-alpine

# Install Node.js runtime
RUN apk add --no-cache nodejs npm

# Copy nginx config
COPY nginx.conf /etc/nginx/conf.d/default.conf

# Copy frontend static files
COPY index.html /usr/share/nginx/html/
COPY templates/ /usr/share/nginx/html/templates/

# Copy backend
COPY backend/ /app/backend/
COPY --from=backend-build /app/backend/node_modules /app/backend/node_modules

# Entrypoint script starts both backend and nginx
COPY start.sh /start.sh
RUN sed -i 's/\r$//' /start.sh && chmod +x /start.sh

# Environment variables — set these in Azure App Service / container settings
# ANTHROPIC_API_KEY=sk-ant-...
# EZEKIA_API_KEY=...
# EZEKIA_BASE_URL=https://ezekia.com/api
# AZURE_TENANT_ID=<tenant-guid>          (Microsoft SSO — required)
# AZURE_CLIENT_ID=<app-registration-guid> (Microsoft SSO — required)

EXPOSE 80

CMD ["/start.sh"]
