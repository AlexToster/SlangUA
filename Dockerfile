FROM node:22-bookworm-slim AS backend-build

WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci

COPY tsconfig.json ./
COPY prisma ./prisma
COPY scripts ./scripts
COPY src ./src

RUN npm run build

FROM node:22-bookworm-slim AS frontend-build

WORKDIR /app

COPY frontend/package.json frontend/package-lock.json ./
RUN npm ci

COPY frontend ./

ARG VITE_API_BASE_URL=/api/v1
ENV VITE_API_BASE_URL=${VITE_API_BASE_URL}

RUN npm run build

FROM node:22-bookworm-slim AS api

WORKDIR /app
ENV NODE_ENV=production

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
