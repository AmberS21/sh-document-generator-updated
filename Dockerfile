# ── Stage 1: Build Node.js backend dependencies ──────────────────────────────
FROM public.ecr.aws/docker/library/node:18-alpine AS backend-build
WORKDIR /app/backend
COPY backend/package.json ./
RUN npm install --production

# ── Stage 2: Final image — nginx (frontend) + Node.js (backend) ──────────────
FROM public.ecr.aws/docker/library/nginx:1.27-alpine

# Install Node.js and supervisord
RUN apk add --no-cache nodejs npm supervisor

# Copy nginx config
COPY nginx.conf /etc/nginx/conf.d/default.conf

# Copy frontend static files
COPY index.html /usr/share/nginx/html/
COPY templates/ /usr/share/nginx/html/templates/

# Copy backend
COPY backend/ /app/backend/
COPY --from=backend-build /app/backend/node_modules /app/backend/node_modules

# Copy supervisord config
COPY supervisord.conf /etc/supervisord.conf

# Environment variables — set these in Azure App Service / container settings
# ANTHROPIC_API_KEY=sk-ant-...
# EZEKIA_API_KEY=...
# EZEKIA_BASE_URL=https://ezekia.com/api

EXPOSE 80

CMD ["/usr/bin/supervisord", "-c", "/etc/supervisord.conf"]
