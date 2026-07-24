# 硅基人才平台 (Silicon Talent Platform)

AI 能力订阅平台 —— 让企业和个人像"雇佣员工"一样订阅 AI 能力，通过对话窗口完成业务任务。

## 服务地址

| 服务 | 地址 | 说明 |
|------|------|------|
| **前端** | http://localhost:3000 | 用户端 + 管理端界面 |
| **后端 API** | http://localhost:3001 | NestJS REST API |
| **Swagger 文档** | http://localhost:3001/api/docs | 接口文档，Bearer Token 鉴权测试 |
| **Prisma Studio** | http://localhost:5555 | 数据库可视化，运行 `pnpm db:studio` 启动 |

## 测试账号

> 所有演示账号统一密码：**`Demo123456`**

| 角色 | 邮箱 | 密码 | 登录后跳转 | 备注 |
|------|------|------|-----------|------|
| 管理员 | `admin@sep.local` | `Demo123456` | `/admin` | 可审核能力、管理员工 |
| 普通用户 | `user@sep.local` | `Demo123456` | `/dashboard` | 已预置订阅「小海」，仪表盘有数据 |
| 新注册用户 | 自定义 | 自定义（≥ 8 位） | `/dashboard` | 空状态，需先去员工广场订阅 |

运行 `pnpm db:seed` 写入以上种子账号（幂等，可重复执行）。

## 快速开始

**依赖**：Node.js ≥ 20、pnpm ≥ 9、Docker

```bash
# 1. 安装依赖
pnpm install

# 2. 启动本地数据库（PostgreSQL + Redis）
docker-compose up -d

# 3. 初始化数据库 + 写入演示数据
pnpm db:migrate && pnpm db:generate && pnpm db:seed

# 4. 启动后端（http://localhost:3001）
pnpm dev:backend

# 5. 启动前端（http://localhost:3000）
pnpm dev:web
```

## 路由说明

### 用户端

| 路径 | 页面 | 说明 |
|------|------|------|
| `/` | 根路由 | 自动重定向到 `/login` |
| `/login` | 登录 | 邮箱 + 密码 |
| `/register` | 注册 | 姓名（可选）+ 邮箱 + 密码 |
| `/dashboard` | 工作台 | 活跃订阅数、会话数、消息数、员工快捷入口、最近会话 |
| `/marketplace` | 员工广场 | 浏览 / 搜索 / 订阅碳基员工 |
| `/marketplace/[id]` | 员工详情 | 员工信息 + 硅基能力列表 |
| `/chat` | 对话中心 | 会话列表 + SSE 流式对话（支持工具调用可视化） |
| `/subscriptions` | 我的订阅 | 查看 / 取消订阅 |
| `/settings` | 个人设置 | 修改姓名 / 头像、修改密码、退出登录 |

### 管理端（需要 ADMIN 角色）

| 路径 | 页面 | 说明 |
|------|------|------|
| `/admin` | 管理仪表盘 | 待审能力数、员工总数、能力总数、待审列表预览 |
| `/admin/capabilities` | 能力审核 | 待审核 / 全部两个 Tab，逐条通过或拒绝（需填原因） |
| `/admin/employees` | 员工管理 | 完整 CRUD；编辑时可绑定 / 解绑硅基能力 |

## 环境变量

复制 `.env.example` 为 `.env`，填写以下关键配置：

| 变量 | 说明 |
|------|------|
| `DATABASE_URL` | PostgreSQL 连接串，本地默认已填好 |
| `SUB2API_BASE_URL` | 算力中转站地址（`https://longdaoai.cn/v1`） |
| `SUB2API_API_KEY` | 算力中转站 Key |
| `SUB2API_DEFAULT_MODEL` | 默认模型，如 `gemini-2.5-flash-high` |

## 项目结构

```
SEP/
├── backend/             后端 API（NestJS）
│   ├── prisma/          数据库 Schema + 迁移文件
│   ├── src/
│   │   ├── shared/      共享类型 / Zod DTO
│   │   ├── modules/     业务模块
│   │   └── main.ts
│   └── package.json
├── web/                 前端（Next.js，待开发）
│   └── src/app/
│       ├── (user)/      用户端
│       ├── (admin)/     运营端
│       └── (contributor)/ 贡献者端
├── docs/                架构文档
├── docker-compose.yml   PostgreSQL + Redis
└── .env                 环境变量
```

## 核心概念

**碳基员工（Digital Employee）**：平台售卖的"岗位包"，例如"电商运营专员"。  
本质是一个 Agent（Vercel AI SDK），内置 System Prompt，绑定多个硅基能力作为工具。

**硅基能力（Silicon Capability）**：第三方贡献者上传的 AI 能力，分 4 种类型：

| 类型 | 说明 |
|------|------|
| Agent | Coze / Dify / N8N 等平台的智能体 |
| RPA | 实在智能 / 影刀 等 RPA 流程 |
| Skill | 提示词模板 + LLM（也可对接 OpenCode） |
| AI 应用 | 独立 Web 应用或 API |

所有能力对碳基员工暴露统一的 `execute()` 接口（适配器模式）。

## 技术栈

| 层 | 技术 |
|----|------|
| 后端 | NestJS 10 + Prisma 6 + PostgreSQL 16 |
| Agent 运行时 | Vercel AI SDK (`ai ^4`) |
| 模型调用 | 全部走 sub2api（OpenAI 兼容中转站） |
| 认证 | JWT（`@nestjs/jwt` + `passport-jwt`） |
| 前端 | React + Next.js（待开发） |
| 基础设施 | Docker Compose（本地）→ 生产自行部署 |

## 外部依赖服务

这两个服务**不在本仓库**，不由 docker-compose 管理，通过 `.env` 连接：

- **sub2api**：算力中转站（OpenAI 兼容端点），所有模型调用必须走它
- **OpenCode Skills Service**：参考 `yaoruiquan/opencode-skiills-service`，作为一种硅基能力类型接入，不是平台前置依赖

## 数据库操作

```bash
pnpm db:migrate          # 创建并应用迁移（修改 schema 后执行）
pnpm db:generate         # 重新生成 Prisma Client
pnpm db:studio           # 打开 Prisma Studio 可视化管理数据
pnpm db:reset            # 重置数据库（仅开发环境）
```

## 架构文档

详见 `docs/` 目录。注意：文档为规划阶段产物，其中部分概念（独立 Gateway 进程、ModelRelayClient 等）与当前实际代码不符，以代码为准。
