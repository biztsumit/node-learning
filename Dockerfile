# The API as a container image: Node, our code and its production packages, nothing else.
#
#   docker build -t ecommerce-api .
#
# Two stages: the first installs packages, the second copies only the result. Build tools and
# npm's download cache stay behind in the first stage, so the final image is smaller.

# ---------- Stage 1: install production dependencies ----------
# node:24-alpine = Node 24 (same as package.json "engines") on Alpine Linux, a ~5 MB base system
FROM node:24-alpine AS deps
WORKDIR /app

# Only the package files first. Docker caches each step: as long as these two files don't change,
# the slow "npm ci" below is reused from cache, even when the code changes.
COPY package.json package-lock.json ./
# Exactly the versions in package-lock.json, without devDependencies (tests, nodemon...)
RUN npm ci --omit=dev && npm cache clean --force

# ---------- Stage 2: the image that actually runs ----------
FROM node:24-alpine
WORKDIR /app
ENV NODE_ENV=production

COPY --from=deps /app/node_modules ./node_modules
COPY package.json ./
COPY src ./src
COPY public ./public

# Log-mode emails are saved in .emails/; it must exist and belong to the user below
RUN mkdir -p .emails && chown node:node .emails

# Run as the unprivileged "node" user (built into the image), not root: if someone ever broke
# into the app, they couldn't change the app's files or the system
USER node

EXPOSE 3000

# Docker itself checks the app is healthy (docker ps shows "healthy"), using our /health route
HEALTHCHECK --interval=10s --timeout=3s --start-period=20s --retries=3 \
  CMD wget -qO- http://127.0.0.1:3000/health || exit 1

# "node", not "npm start": npm wouldn't pass Docker's stop signal (SIGTERM) on to the app,
# so the graceful shutdown in server.ts would never run and Docker would kill it after 10s.
CMD ["node", "src/server.ts"]
