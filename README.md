# 飞书项目复刻

复刻飞书项目（Meego）的核心能力：工作项、节点流程、排期、自动化、公式字段和权限。设计文档见 Claude Docs「飞书项目复刻：数据模型与流程引擎设计」。

全栈 TypeScript monorepo。流程引擎只有一份代码，服务端用它做权威计算，浏览器用同一份代码做实时校验和预览。

## 目录

| 路径 | 内容 |
| --- | --- |
| `packages/engine` | 流程引擎：零依赖纯 TypeScript，服务端和浏览器共用。`src/samples/oem-v289.ts` 是 OEM v289 流程的验收数据 |
| `apps/web` | 前端：React 19 + Vite + Tailwind CSS v4 + React Flow。目前是一个可以点着走完 OEM 流程的演示页 |
| `apps/api` | 后端：Node.js 24 + Hono。目前只有健康检查和流程校验接口 |
| `apps/worker` | Temporal worker（每个工作项一个事件流 workflow，按顺序处理事件）和 Outbox 中继 |
| `packages/db` | PostgreSQL 17 + Drizzle：表结构、迁移、`appendEvents`（业务写入和事件同一事务） |
| `packages/sync` | Zero schema，由 drizzle-zero 从 `packages/db` 的表结构生成 |
| `docker-compose.yml` | Postgres（pgvector、逻辑复制）、Temporal + UI、zero-cache、迁移；`app` profile 再加 API、worker、中继 |

## 事件怎么流转

业务写入时在同一个事务里调用 `appendEvents`：写 `event_log`，写 `infra.outbox`，发 NOTIFY。
中继（`apps/worker/src/relay.ts`）收到通知后，按 id 顺序把事件用 signalWithStart 交给 `stream:work_item:<id>` 这个 workflow；
workflow 逐条调用 activity 处理，按事件 id 丢弃重复投递。只有一个中继能拿到领导者锁，所以同一个工作项的事件不会乱序；
投递失败的事件留在 outbox 里，下一轮从它开始重试。

`infra` schema 里的表（outbox、登录会话和凭据、向量）不进 Zero 的 publication，不会同步到浏览器。

## 运行

需要 Node.js 24 和 pnpm 10。

```bash
pnpm install
pnpm test        # 所有包的测试
pnpm typecheck
pnpm check       # Biome 格式和代码检查
```

```bash
pnpm --filter @fp/web dev   # 演示页 http://localhost:5173
pnpm --filter @fp/api dev   # API http://localhost:3000
```

基础设施用 Docker Compose 起：

```bash
docker compose up -d                   # Postgres :5432、Temporal :7233、Temporal UI http://localhost:8080、zero-cache :4848，并跑迁移
docker compose --profile app up -d     # 再加 API :3000、Temporal worker、Outbox 中继（部署时设 ZERO_API_ORIGIN=http://api:3000）
```

集成测试需要真实的 Postgres 和 Temporal：

```bash
docker compose up -d --wait postgres temporal && docker compose run --rm temporal-namespace
pnpm test:integration
```

改了 `packages/db/src/schema.ts` 之后：

```bash
pnpm db:generate   # 生成迁移，并重新生成 Zero schema
```

## 当前进度

- [x] 流程引擎：节点状态、分叉汇聚、开关裁剪（汇聚时跳过）、单人确认 / 会签 / 自动完成 / 子工作项驱动、卡点、阶段改写、回滚、工作项完成判定、发布前校验
- [x] OEM 流程演示页
- [ ] 排期引擎（正排、倒排、多参照）
- [ ] 公式字段
- [ ] 自动化引擎
- [x] 基础设施：Docker Compose、数据库表结构和迁移、Zero schema、Temporal worker、Outbox 中继
- [ ] 登录（Better Auth）、Zero 的服务端 mutator 和查询接口、oRPC 接口
- [ ] 正式的前端页面：空间、工作项列表、详情、模板编辑器
