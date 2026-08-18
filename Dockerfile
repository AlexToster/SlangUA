# Pinned to an exact patch on purpose: a floating `node:22` tag changes the
# runtime between two builds of the same commit. Bump it here — the ARG is used
# by every Node stage below, so they can never drift apart. Must stay >= 22.12.0
# to satisfy `engines.node` in frontend/package.json.
ARG NODE_IMAGE=node:22.23.2-bookworm-slim

FROM ${NODE_IMAGE} AS backend-build

WORKDIR /app

RUN apt-get update \
  && apt-get install -y --no-install-recommends openssl \
  && rm -rf /var/lib/apt/lists/*

COPY package.json package-lock.json ./
RUN npm ci

COPY tsconfig.json ./
COPY prisma ./prisma
RUN npx prisma generate

COPY scripts ./scripts
COPY src ./src

RUN npm run build

FROM ${NODE_IMAGE} AS frontend-build

WORKDIR /app

COPY frontend/package.json frontend/package-lock.json ./
RUN npm ci

COPY frontend ./

ARG VITE_API_BASE_URL=/api/v1
ENV VITE_API_BASE_URL=${VITE_API_BASE_URL}

RUN npm run build

FROM ${NODE_IMAGE} AS api

WORKDIR /app
ENV NODE_ENV=production

RUN apt-get update \
  && apt-get install -y --no-install-recommends openssl \
  && rm -rf /var/lib/apt/lists/*

COPY --from=backend-build /app/package.json ./
COPY --from=backend-build /app/node_modules ./node_modules
COPY --from=backend-build /app/prisma ./prisma
COPY --from=backend-build /app/dist ./dist

EXPOSE 3000
CMD ["node", "dist/app.js"]

FROM nginx:1.27-alpine AS frontend

COPY deploy/nginx/frontend.conf /etc/nginx/conf.d/default.conf
COPY --from=frontend-build /app/dist /usr/share/nginx/html

EXPOSE 80
