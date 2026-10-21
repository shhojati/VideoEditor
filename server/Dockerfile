# Account API (see server/src/index.ts). No dependencies: Node runs the TypeScript directly and
# stores data with the built-in node:sqlite. Mount a volume at /data.
FROM node:24-slim
WORKDIR /app
COPY src ./src
ENV NODE_ENV=production PORT=3000 DB_PATH=/data/app.db
# node:sqlite still prints an "experimental" warning on start.
ENV NODE_NO_WARNINGS=1
# Runs as root: the host bind-mounts ./data, which the deploy user creates with its own owner.
RUN mkdir -p /data
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=3s CMD node -e "fetch('http://127.0.0.1:3000/api/health').then(r=>process.exit(r.ok?0:1),()=>process.exit(1))"
CMD ["node", "src/index.ts"]
