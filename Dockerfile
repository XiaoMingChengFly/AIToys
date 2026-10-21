# 服务端镜像：API、Temporal worker、Outbox 中继和数据库迁移共用，靠 command 区分。
# Node 24 直接运行 TypeScript（类型擦除），不需要构建步骤。
FROM node:24-slim
ENV PNPM_HOME=/pnpm PATH=/pnpm:$PATH NODE_ENV=production
RUN corepack enable
WORKDIR /app
COPY . .
RUN pnpm install --frozen-lockfile --filter "@fp/api..." --filter "@fp/worker..." --filter "@fp/db..."
CMD ["node", "apps/api/src/server.ts"]
