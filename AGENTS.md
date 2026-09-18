# SEP — 项目协作核心规则

## 协作与安全
- 默认中文回复，代码/命令/接口字段保留原文。保留用户已有修改，不擅自删除文件、提交、push 或合并分支。
- 完成较大模块后先测试并总结，再提醒用户提交 Git；需要同步远程时再提醒推送。
- 小范围、可回滚修改；不新增未经请求的依赖。重构前写计划，覆盖不足先补回归测试。
- 不读取/输出无关密钥，不把 `.env` 或私有配置备份写入 Git；数据库破坏性操作必须明确授权。

## 项目与定位
- 硅基人才平台：用户订阅 Digital Employees，通过对话调用 agent/rpa/skill/ai-app 能力，统一适配器 `execute()` 接口。
- pnpm workspace：`backend/` + `web/`；Node >=20，TypeScript。后端 NestJS + Prisma + PostgreSQL/Redis；前端 Next.js App Router + Shadcn/ui/Tailwind。
- 业务模块：`backend/src/modules/<feature>/`；共享 DTO/Zod/类型：`backend/src/shared/`；Prisma schema/migrations：`backend/prisma/`。
- 前端三面板：`web/src/app/(market)`、`(enterprise)`、`(platform)`；功能组件按 `features/<feature>` 聚合，全局可复用 UI 放 `components/`。

## 后端不可违背的约束
- controller 仅处理 HTTP/Swagger；业务逻辑放 service；新模块注册到 `app.module.ts`。
- 共享 DTO 用 `shared` alias 导入；请求先经共享 Zod DTO 校验，不把原始 req.body 直接传给 service。
- 使用 Nest HTTP exceptions，不抛原始 Error、不吞异常；受保护接口使用 JwtAuthGuard，用户来自 req.user。
- 每个接口补齐 Swagger ApiTags/ApiOperation/ApiResponse。
- 数据库操作统一注入 PrismaService；业务代码不得 new PrismaClient。
- 改 schema 后依次 `pnpm db:migrate` → `pnpm db:generate`；迁移由工具生成，不手写修改历史迁移。
- Prisma IDs 使用 cuid，表名 @@map 为 snake_case 复数，保留 createdAt/updatedAt；Nest 文件 kebab-case、类 PascalCase、变量 camelCase。
- 所有模型调用经 sub2api（SUB2API_BASE_URL / SUB2API_API_KEY）；不得从应用代码直接接 OpenAI/DeepSeek 等上游。

## 前端与认证
- Access token 仅存内存/Zustand，禁止 localStorage；refresh token 为后端设置的 httpOnly cookie。刷新页面通过 GET /auth/refresh 恢复内存 token。
- 服务端数据统一 TanStack Query query/mutation hooks；Zustand 管 UI 状态。表单复用共享 Zod schema，不复制校验逻辑。
- SSE 保持与后端流协议兼容；不因纯 UI 修改改动认证或业务契约。
- 三面板共用设计语言，优先复用现有组件；视觉修改做实际页面/截图验证，不能仅靠编译通过宣称视觉正确。

## 常用命令与验证
```bash
pnpm install
# 本地 PostgreSQL + Redis（需要时）
docker-compose up -d
pnpm dev:backend
pnpm dev:web
pnpm test:backend
pnpm test:web
pnpm --dir web exec tsc --noEmit --incremental false
pnpm build
pnpm db:migrate
pnpm db:generate
```
- 先跑改动对应测试，再按影响范围做 typecheck/lint/build/smoke；只改文档/配置时检查语法、diff 和非目标配置不变，无需跑全量业务测试。
- 后端单测与实现同目录 `*.spec.ts`，mock PrismaService、不连真实 DB；E2E 在 `backend/test/`。
- 最终报告变更文件、检查结果及未验证项；未经执行的测试不得声称通过。
- 提交遵守 Conventional Commits（feat/fix/refactor/chore/docs/test/perf），必要时附全局 Lore trailers。

## 按需文档（不要默认全文加载）
- 本次精简前完整项目说明：`docs/development/agent-reference.md`。仅需命名示例、目录细节或历史约定时查对应章节。
- 需求与架构：`docs/architecture/硅基人才平台-需求与架构规格书-v2.md`；选型：`docs/architecture/技术选型决策文档.md`；进度：`docs/progress/`。
- 架构文档是规划期产物，以代码和用户最新要求为准。没有独立 Gateway；ModelRelayClient/new-api 指 sub2api，不照文档擅建过度设计的基础设施。
