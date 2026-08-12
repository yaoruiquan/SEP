# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this project is

**硅基人才平台 (Silicon Talent Platform / SEP)** — a platform where users subscribe to
**Digital Employees (硅基员工)** and use them through a ChatGPT-style chat. Each Digital
Employee is an agent (Vercel AI SDK) that orchestrates one or more **Silicon Capabilities
(硅基能力)** — reusable units of type `agent` / `rpa` / `skill` / `ai-app`, each hidden
behind a single `execute()` interface via the adapter pattern.

Full requirements/architecture live in `docs/architecture/` — note that some concepts there may be outdated; always verify against actual code.

## Tech stack

### Backend

| Area | Choice | Notes |
|------|--------|-------|
| Language | TypeScript `^5.7` | Strict-ish; see `backend/tsconfig.json` |
| Runtime | Node `>=20` | |
| Monorepo | pnpm workspace `9.15` | `backend/` + `web/` |
| Backend | NestJS `^10.4` | `backend/` |
| ORM / DB | Prisma `^6` + PostgreSQL 16 | schema in `backend/prisma/` |
| Auth | `@nestjs/jwt` + `passport-jwt`, bcrypt | JWT, 7d expiry; httpOnly cookie for web |
| Validation | Zod (shared DTOs) + class-validator (Nest pipes) | shared DTOs in `backend/src/shared/` |
| API docs | `@nestjs/swagger` | served at `/api/docs`; Bearer token for Swagger testing |
| Agent Runtime | Vercel AI SDK (`ai ^7`, `@ai-sdk/openai-compatible`) | all model calls via sub2api |
| Cache | Redis 7 | |

### Frontend (`web/` — ✅ 已实现)

| Area | Choice | Notes |
|------|--------|-------|
| Framework | Next.js 15 App Router | 已实现两个路由组: `(enterprise)` 企业端, `(platform)` 运营端 |
| UI components | Shadcn/ui + Tailwind CSS | 已实现 20+ 组件: Button/Card/Dialog/Switch/Badge/Input 等 |
| Server state | TanStack Query v5 | API 调用, 缓存, 自动失效已实现 |
| Client state | Zustand | 认证状态管理 (auth-store) |
| Forms | react-hook-form + zod | 表单验证已实现 |
| Data tables | - | 使用原生 table + 卡片布局 |
| Chat rendering | react-markdown + highlight.js | 待实现（聊天功能） |
| Auth storage | LocalStorage + API | access token 存储，JWT 认证 |
| Date/time | date-fns | 已使用 |
| Charts | recharts ^3.10 | Dashboard 数据可视化 |
| Drag & Drop | @dnd-kit | 能力绑定拖拽排序 |

## Commands

Key Prisma commands (run in `backend/` or via `pnpm` from root):
```bash
pnpm db:generate    # 重新生成 Prisma Client（改 schema 后执行）
pnpm db:migrate     # 创建并应用迁移
pnpm db:studio      # Prisma Studio
```

Standard commands: `pnpm install`, `docker-compose up -d`, `pnpm dev:backend`, `pnpm dev:web`, `pnpm build`.

## Repo layout & where things go

```
SEP/
├── backend/                NestJS API（主要开发目标）
│   ├── prisma/
│   │   ├── schema.prisma   数据库 Schema（14 个核心实体）
│   │   └── migrations/     自动生成，不要手动修改
│   ├── src/
│   │   ├── shared/         Zod DTO + 共享 TS 类型（原 contracts 包）
│   │   ├── prisma/         PrismaService（全局注入）
│   │   ├── modules/        业务模块，每个功能一个目录
│   │   └── main.ts
│   ├── .env                DATABASE_URL（本地 Prisma CLI 用）
│   └── package.json
│
├── web/                    Next.js 前端（待开发）
│   └── src/app/
│       ├── (user)/         用户端路由组
│       ├── (admin)/        运营端路由组
│       └── (contributor)/  贡献者端路由组
│
├── docs/                   架构文档（规划期产物，以代码为准）
├── docker-compose.yml      本地开发：PostgreSQL + Redis
├── .env                    根环境变量（后端运行时读这个）
└── pnpm-workspace.yaml     ["backend", "web"]
```

- **共享类型/DTO 放 `backend/src/shared/`**，用相对路径 import（`import { X } from 'shared'`）
- **所有 DB 操作通过 `PrismaService`**，不要 `new PrismaClient()`
- **改 `schema.prisma` 后**：`pnpm db:migrate` → `pnpm db:generate`

## Naming conventions

| Thing | Convention | Example |
|-------|-----------|---------|
| NestJS files | `kebab-case.<type>.ts` | `digital-employee.service.ts` |
| Classes | `PascalCase` | `DigitalEmployeeService` |
| Variables / functions | `camelCase` | `findByEmployeeId` |
| Zod schemas | `PascalCase + Schema` suffix | `CapabilityUploadDtoSchema` |
| Prisma models | `PascalCase` | `DigitalEmployee` |
| DB table names (`@@map`) | `snake_case` plural | `digital_employees` |
| Enums (Prisma) | `UPPER_SNAKE` | `CAPABILITY_TYPE` |
| React components | `PascalCase.tsx` | `ChatWindow.tsx` |
| Env vars | `UPPER_SNAKE` | `SUB2API_API_KEY` |

## Backend conventions (NestJS)

**Module structure** — one feature = `src/modules/<feature>/`:
```
digital-employee.module.ts
digital-employee.controller.ts   ← HTTP + Swagger only, no logic
digital-employee.service.ts      ← all business logic
digital-employee.types.ts        ← local types if needed
```
Register every new module in `src/app.module.ts`.

**Error handling** — use NestJS built-in HTTP exceptions; never throw raw `Error`:
```typescript
throw new NotFoundException(`Employee ${id} not found`);
throw new ConflictException('Email already registered');
throw new UnauthorizedException('Invalid credentials');
throw new BadRequestException('Capability type mismatch');
```
Services throw; controllers let them bubble. Do not catch-and-swallow.

**Request validation** — validate with the Zod DTO from `shared`, then pass the
typed object to the service. Never pass raw `req.body` to a service.

**Auth** — protect routes with `@UseGuards(JwtAuthGuard)`. Get the current user via
`@Request() req` → `req.user` (set by `JwtStrategy.validate`).

**Swagger** — every endpoint needs `@ApiTags`, `@ApiOperation`, and a relevant
`@ApiResponse`. Swagger is the API contract between backend and frontend.

**Prisma conventions**:
- IDs: `@id @default(cuid())`
- All models have `createdAt DateTime @default(now())` and `updatedAt DateTime @updatedAt`
- Table name mapped via `@@map("snake_case_plural")`
- After editing `schema.prisma`: `pnpm db:migrate` (creates migration) → `pnpm db:generate` (rebuilds client)
- Never `new PrismaClient()` in app code — inject `PrismaService`

## Imports

All shared DTOs/types live in `backend/src/shared/`. Import via the `baseUrl` alias:
```typescript
import { CapabilityUploadDtoSchema } from 'shared';   // ✅  (baseUrl: "./src")
import { RegisterDto } from 'shared';                  // ✅
import { something } from '../../../shared/…';         // ❌  use alias
import { PrismaClient } from '@prisma/client';         // ✅  (but only in PrismaService)
```
Within the same module, relative imports are fine. Never `new PrismaClient()` in feature code.

## Testing

- Unit tests co-located: `foo.service.spec.ts` next to `foo.service.ts`
- E2E tests under `backend/test/`
- Run: `pnpm test` (unit) · `pnpm test:cov` (coverage) · `pnpm test:e2e`
- Mock `PrismaService` in unit tests — don't hit the real DB

## Frontend conventions (Next.js / web/)

> `web/` is not yet scaffolded. These conventions apply once it is.

**Route groups** — three isolated panels, each with its own layout:
```
web/src/app/
├── (user)/          用户端：chat, subscription, profile
├── (admin)/         运营端：capability review, user management, billing
└── (contributor)/   贡献者端：capability upload, version management
```

**Auth — httpOnly cookie**
- Access token stored **in memory** (Zustand store), never in `localStorage`
- Refresh token in **httpOnly cookie** set by the backend `/auth/login` response
- Swagger testing still uses `Authorization: Bearer <token>` header — unaffected
- On page reload, call `GET /auth/refresh` to rehydrate the in-memory token

**Server state with TanStack Query**
```typescript
// ✅ All API calls go through query/mutation hooks
const { data: me } = useQuery({ queryKey: ['users', 'me'], queryFn: fetchMe });
const updateProfile = useMutation({ mutationFn: patchProfile });

// ✅ SSE streaming (conversation) uses useQuery with a custom fetcher
```

**Zod schema reuse** — import shared schemas from `backend/src/shared/` (or a symlinked
package once `web/` is set up). Never re-define validation logic in the frontend:
```typescript
import { RegisterDtoSchema } from '@sep/shared';   // shared Zod schema
const form = useForm({ resolver: zodResolver(RegisterDtoSchema) });
```

**Component file layout** — co-locate by feature, not by type:
```
web/src/
├── components/          global reusable UI only (Button, Modal, etc.)
├── features/
│   ├── chat/            ChatWindow, MessageBubble, InputBar
│   ├── capability/      CapabilityCard, UploadForm
│   └── employee/        EmployeeSelector, BindingPanel
└── lib/                 API client, query hooks, utils
```

**Streaming (SSE)** — Layer 5 conversation uses `streamText` on the backend via NestJS SSE
(`@Sse`). The frontend consumes it with `EventSource` or `fetch` + `ReadableStream`.

## Git commits

Follow [Conventional Commits](https://www.conventionalcommits.org/):
```
feat(capability): add Coze agent adapter
fix(auth): handle expired JWT correctly
chore(db): add ToolExecution index on sessionId
```
Types: `feat` `fix` `refactor` `chore` `docs` `test` `perf`

## External services (NOT in this repo, NOT in docker-compose)

- **sub2api** — a self-hosted token relay with an **OpenAI-compatible** endpoint. **All
  model calls route through it** (app code and OpenCode alike) so compute is metered
  centrally and users never hold upstream keys. Connect via `SUB2API_BASE_URL` /
  `SUB2API_API_KEY`. Wire it into the Vercel AI SDK with `createOpenAICompatible`.
- **OpenCode Skills Service** — a standalone HTTP service (ref:
  `yaoruiquan/opencode-skiills-service`) that runs SKILL.md capabilities via a job API
  (`POST /v1/runs`, `GET /v1/runs/{id}`, `GET /health`). The backend calls it over HTTP,
  same shape as calling Coze. Connect via `OPENCODE_API_BASE_URL` / `OPENCODE_API_TOKEN`.

Never connect to DeepSeek / OpenAI / etc. directly from app code — always via sub2api.

## MCP Tools: code-review-graph

**ALWAYS use code-review-graph MCP tools BEFORE Grep/Glob/Read.** The graph gives structural context (callers, dependencies, test coverage) that file scanning cannot. Use `/mcp` to list available tools.

Key scenarios: code review (`detect_changes_tool`), impact analysis (`get_impact_radius_tool`), finding relationships (`query_graph_tool`), architecture overview (`get_architecture_overview_tool`).
