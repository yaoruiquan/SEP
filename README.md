# 硅基人才平台 (Silicon Talent Platform)

AI 能力订阅平台 —— 让企业和个人像"雇佣员工"一样订阅 AI 能力，通过对话窗口完成业务任务。

## 项目状态

✅ **第 0 层：基础设施** 已完成 | 🔄 **当前：搭建平台核心功能**

## 快速开始

**依赖**：Node.js ≥ 20、pnpm ≥ 9、Docker

```bash
# 1. 安装依赖
pnpm install

# 2. 启动本地数据库（PostgreSQL + Redis）
docker-compose up -d

# 3. 初始化数据库
pnpm db:migrate && pnpm db:generate

# 4. 启动后端（http://localhost:3001）
cd apps/platform-api && pnpm dev
```

API 文档：http://localhost:3001/api/docs

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
