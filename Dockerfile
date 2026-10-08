# Multi-stage build. The runner keeps `node_modules` complete (including the
# `tsx` devDependency) so the `npm run worker` and `npm run migrate` helpers —
# which execute TypeScript directly — work in the deployed container.
FROM node:22-alpine AS deps
WORKDIR /app
ENV NEXT_TELEMETRY_DISABLED=1
COPY package.json package-lock.json ./
RUN npm ci

FROM node:22-alpine AS builder
WORKDIR /app
ENV NEXT_TELEMETRY_DISABLED=1
COPY --from=deps /app/node_modules ./node_modules
COPY . .
RUN npm run build

FROM node:22-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production NEXT_TELEMETRY_DISABLED=1
COPY --from=deps /app/node_modules ./node_modules
COPY --from=builder /app/.next ./.next
COPY --from=builder /app/public ./public
COPY --from=builder /app/package.json ./package.json
COPY --from=builder /app/src ./src

# Run unprivileged. Without a USER directive the container runs as root, so any
# code-execution foothold (a parser bug, a malicious document, a dependency
# advisory) is root inside the container and starts from a much better position
# for a container escape. Uploads live on a volume owned by the same user so the
# app can still write the documents it receives.
RUN mkdir -p /data/uploads && chown -R node:node /data/uploads /app

USER node
ENV PORT=3000 HOSTNAME=0.0.0.0 STORAGE_DIR=/data/uploads
EXPOSE 3000
CMD ["npm", "run", "start"]
