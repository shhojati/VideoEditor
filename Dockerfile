# Static build served by nginx. Whisper models are not baked in (~1.1 GB): mount them at
# /usr/share/nginx/html/models (see deploy/docker-compose.yml and docs/DEPLOY.md).

FROM node:22-slim AS build
WORKDIR /app
COPY package.json package-lock.json ./
# Install scripts only fetch native binaries for Node-side packages (onnxruntime-node, sharp)
# that the browser build never uses.
RUN npm ci --ignore-scripts --no-audit --no-fund
COPY . .
RUN npm run build

FROM nginx:1.27-alpine
COPY deploy/nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /app/dist /usr/share/nginx/html
EXPOSE 80
HEALTHCHECK --interval=30s --timeout=3s CMD wget -q --spider http://127.0.0.1/ || exit 1
