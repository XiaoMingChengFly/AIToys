# 飞书项目复刻

复刻飞书项目（Meego）的核心能力：工作项、节点流程、排期、自动化、公式字段和权限。设计文档见 Claude Docs「飞书项目复刻：数据模型与流程引擎设计」。

全栈 TypeScript monorepo。流程引擎只有一份代码，服务端用它做权威计算，浏览器用同一份代码做实时校验和预览。

## 目录

| 路径 | 内容 |
| --- | --- |
| `packages/engine` | 流程引擎：零依赖纯 TypeScript，服务端和浏览器共用。`src/samples/oem-v289.ts` 是 OEM v289 流程的验收数据 |
| `apps/web` | 前端：React 19 + Vite + Tailwind CSS v4 + React Flow。目前是一个可以点着走完 OEM 流程的演示页 |
| `apps/api` | 后端：Node.js 24 + Hono。目前只有健康检查和流程校验接口 |

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

## 当前进度

- [x] 流程引擎：节点状态、分叉汇聚、开关裁剪（汇聚时跳过）、单人确认 / 会签 / 自动完成 / 子工作项驱动、卡点、阶段改写、回滚、工作项完成判定、发布前校验
- [x] OEM 流程演示页
- [ ] 排期引擎（正排、倒排、多参照）
- [ ] 公式字段
- [ ] 自动化引擎
- [ ] 数据库（PostgreSQL + Drizzle）、登录（Better Auth）、oRPC 接口
- [ ] 正式的前端页面：空间、工作项列表、详情、模板编辑器
