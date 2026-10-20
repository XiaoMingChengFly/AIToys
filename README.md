# 飞书项目复刻

复刻飞书项目（Meego）的核心能力：工作项、节点流程、排期、自动化、公式字段和权限。设计文档见 Claude Docs「飞书项目复刻：数据模型与流程引擎设计」。

## 目录

| 路径 | 内容 |
| --- | --- |
| `backend/src/FeishuProject.Engine` | 流程引擎类库：不依赖数据库和 Web，所有规则都在这里计算 |
| `backend/src/FeishuProject.Api` | ASP.NET Core Web API（.NET 10） |
| `backend/tests/FeishuProject.Engine.Tests` | 引擎单元测试，`Fixtures/OemFlow.cs` 是 OEM v289 流程的验收数据 |
| `frontend` | Vue 3 + TypeScript + Vite + Element Plus |

## 运行

```bash
cd backend && dotnet test
```

```bash
cd frontend && npm install && npm run dev
```

## 当前进度

- [x] 流程引擎：节点状态、分叉汇聚、开关裁剪（汇聚时跳过）、单人确认 / 会签 / 自动完成 / 子工作项驱动、卡点、阶段改写、回滚、工作项完成判定、发布前校验
- [ ] 排期引擎（正排、倒排、多参照）
- [ ] 公式字段
- [ ] 自动化引擎
- [ ] 数据库与 API
- [ ] 前端页面
