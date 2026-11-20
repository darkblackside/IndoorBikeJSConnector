# The multiplayer server (Colyseus) as a container. Build from the repository root:
#   docker build -f apps/server/Dockerfile -t indoor-bike-server .
#   docker run -p 8787:8787 -v horde-data:/data -e ALLOWED_ORIGINS=https://darkblackside.github.io indoor-bike-server
# Only game-core and the server are installed: the web app's private UI package (GitHub Packages) is not needed.
FROM node:22-alpine AS build
WORKDIR /app
COPY package.json package-lock.json tsconfig.base.json ./
COPY packages/connector/package.json packages/connector/
COPY packages/game-core/package.json packages/game-core/
COPY apps/web/package.json apps/web/
COPY apps/server/package.json apps/server/
RUN npm ci -w @indoor-bike/game-core -w @indoor-bike/server --no-audit --no-fund
COPY packages/game-core packages/game-core
COPY apps/server apps/server
RUN npm run build -w @indoor-bike/game-core -w @indoor-bike/server

FROM node:22-alpine
ENV NODE_ENV=production PORT=8787 HORDE_DATA_FILE=/data/horde.json
WORKDIR /app
COPY --from=build /app/package.json /app/package-lock.json ./
COPY --from=build /app/packages/connector/package.json packages/connector/
COPY --from=build /app/apps/web/package.json apps/web/
COPY --from=build /app/packages/game-core/package.json packages/game-core/
COPY --from=build /app/apps/server/package.json apps/server/
RUN npm ci --omit=dev -w @indoor-bike/game-core -w @indoor-bike/server --no-audit --no-fund && npm cache clean --force
COPY --from=build /app/packages/game-core/dist packages/game-core/dist
COPY --from=build /app/apps/server/dist apps/server/dist
# The horde's total sweat lives in /data: mount a volume so it survives redeploys.
RUN mkdir -p /data && chown node:node /data
VOLUME /data
USER node
EXPOSE 8787
CMD ["node", "apps/server/dist/index.js"]
