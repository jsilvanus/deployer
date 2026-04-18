# syntax=docker/dockerfile:1
FROM node:20-alpine AS builder

WORKDIR /app

# Build tools required for better-sqlite3 native bindings
RUN apk add --no-cache python3 make g++

COPY package*.json ./
RUN npm ci

COPY tsconfig*.json ./
COPY src/ ./src/

RUN npm run build
# tsc doesn't copy .sql files — copy migrations manually
RUN cp -r src/db/migrations dist/db/migrations

RUN npm prune --omit=dev

# ---- runtime ----
FROM node:20-alpine

WORKDIR /app

COPY --from=builder /app/dist ./dist
COPY --from=builder /app/node_modules ./node_modules
COPY package.json ./

EXPOSE 3000

CMD ["node", "dist/index.js"]
