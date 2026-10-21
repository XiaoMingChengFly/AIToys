# 前端：构建静态文件，交给 Caddy 托管（同时做 HTTPS 和反向代理，见 deploy/Caddyfile）。
FROM node:24-slim AS build
ENV PNPM_HOME=/pnpm PATH=/pnpm:$PATH
RUN corepack enable
WORKDIR /app
COPY . .
RUN pnpm install --frozen-lockfile --filter "@fp/web..."
RUN pnpm --filter @fp/web build

FROM caddy:2.10.2-alpine
COPY deploy/Caddyfile /etc/caddy/Caddyfile
COPY --from=build /app/apps/web/dist /srv
