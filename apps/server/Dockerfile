# syntax=docker/dockerfile:1.10
# Everything in one container: the multiplayer server (Colyseus) and the built web app, served from the same port.
# Built and pushed to ghcr.io by .github/workflows/docker.yml. Locally, from the repository root:
#
#   echo "$GITHUB_TOKEN_WITH_READ_PACKAGES" > /tmp/npm_token
#   docker build -f apps/server/Dockerfile --secret id=npm_token,src=/tmp/npm_token -t indoor-bike .
#   docker run -p 8787:8787 -v horde-data:/data indoor-bike      # then open http://localhost:8787/
#
# The token is needed for the web app's UI library @darkblackside/ui (GitHub Packages). It is a build secret: it
# never ends up in an image layer.

FROM node:22-alpine AS build
WORKDIR /app
COPY .npmrc package.json package-lock.json tsconfig.base.json ./
COPY packages/connector/package.json packages/connector/
COPY packages/game-core/package.json packages/game-core/
COPY apps/web/package.json apps/web/
COPY apps/server/package.json apps/server/
# npm expands ${NODE_AUTH_TOKEN} itself; the value only exists while this RUN runs.
RUN echo '//npm.pkg.github.com/:_authToken=${NODE_AUTH_TOKEN}' >> .npmrc
RUN --mount=type=secret,id=npm_token,env=NODE_AUTH_TOKEN \
    --mount=type=cache,target=/root/.npm \
    npm ci --no-audit --no-fund
COPY packages packages
COPY apps apps
RUN npm run build -w @indoor-bike/game-core -w @indoor-bike/server && npm run build -w @indoor-bike/web

FROM node:22-alpine
ENV NODE_ENV=production PORT=8787 HORDE_DATA_FILE=/data/horde.json WEB_DIR=/app/web
WORKDIR /app
COPY --from=build /app/package.json /app/package-lock.json ./
COPY --from=build /app/packages/connector/package.json packages/connector/
COPY --from=build /app/apps/web/package.json apps/web/
COPY --from=build /app/packages/game-core/package.json packages/game-core/
COPY --from=build /app/apps/server/package.json apps/server/
# Runtime: only game-core and the server (public npm packages; no token needed).
RUN npm ci --omit=dev -w @indoor-bike/game-core -w @indoor-bike/server --no-audit --no-fund && npm cache clean --force
COPY --from=build /app/packages/game-core/dist packages/game-core/dist
COPY --from=build /app/apps/server/dist apps/server/dist
COPY --from=build /app/apps/web/dist web
# The horde's total sweat lives in /data: mount a volume so it survives redeploys.
RUN mkdir -p /data && chown node:node /data
VOLUME /data
USER node
EXPOSE 8787
HEALTHCHECK --interval=30s --timeout=3s --start-period=10s CMD wget -qO- "http://127.0.0.1:${PORT}/__healthcheck" || exit 1
CMD ["node", "apps/server/dist/index.js"]
