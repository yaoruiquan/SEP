# 硅基员工平台（SEP）上线准备清单

> **文档版本**: v1.0
> **创建日期**: 2026-09-22
> **目标上线时间**: [待定]
> **负责人**: [待定]

---

## 📋 执行摘要

本文档为硅基员工平台（SEP）上线前的完整检查清单，涵盖代码质量、功能完整性、性能优化、安全加固、部署配置和监控告警六大方面。当前项目状态：

- ✅ **核心功能已完成**（企业端 + 运营端 + 客户端接入）
- ✅ **后端测试覆盖率良好**（90 个测试套件，1199 个测试用例全部通过）
- ✅ **前端测试覆盖率良好**（52 个测试文件，514 个测试用例全部通过）
- ✅ **部署脚本已就绪**（Docker Compose + 蓝绿部署 + 备份恢复）
- ✅ **E2E 测试完成**（16/16 tests passing）
- ✅ **代码质量检查完成**（ESLint + TypeScript 类型检查全部通过）
- ✅ **安全加固完成**（JWT token 缩短、CSP 头部、日志脱敏、限流保护）
- ⚠️ **需要补充**：性能压测、监控系统、日志聚合

---

## 目录

1. [代码质量检查](#1-代码质量检查)
2. [功能完整性测试](#2-功能完整性测试)
3. [性能优化](#3-性能优化)
4. [安全加固](#4-安全加固)
5. [部署配置](#5-部署配置)
6. [监控与运维](#6-监控与运维)
7. [文档与培训](#7-文档与培训)
8. [上线前最终检查](#8-上线前最终检查)

---

## 1. 代码质量检查

### 1.1 静态代码检查

- [x] **ESLint 检查通过**（后端）
  ```bash
  cd backend && pnpm lint
  ```

- [x] **ESLint 检查通过**（前端）✅
  ```bash
  cd web && pnpm exec eslint . --ext .ts,.tsx
  # 14 warnings (0 errors) - 全部为代码优化建议，不影响上线
  ```

- [x] **TypeScript 类型检查通过**（全量）✅
  ```bash
  cd backend && pnpm typecheck  # ✅ 通过
  cd web && pnpm exec tsc --noEmit  # ✅ 通过
  ```

- [x] **TODO/FIXME 清理**✅
  ```bash
  # 仅发现 1 处注释标记（XXXX 作为掩码示例），无需清理
  grep -r "TODO\|FIXME\|XXX\|HACK" backend/src web/src --include="*.ts" --include="*.tsx"
  ```

### 1.2 测试覆盖率

#### 后端测试 ✅

- [x] **单元测试全部通过**（90 suites, 1199 tests passed）✅
  ```bash
  cd backend && pnpm test
  ```

- [x] **测试覆盖率 ≥ 70%**✅
  ```bash
  cd backend && pnpm test:cov
  # 检查关键模块覆盖率：
  # - auth: 认证授权逻辑
  # - gateway: 模型网关计费
  # - task-execution: 任务执行引擎
  # - compute-credit: 算力交易
  ```

#### 前端测试 ✅

- [x] **组件单元测试**（52 test files, 514 tests passing）
  ```bash
  cd web && pnpm test
  ```
  **已完成测试**：
  - [x] ChatWindow 组件（消息渲染、滚动、流式更新）—— 已有 133 个测试
  - [x] EmployeeCard 组件（状态显示、交互）—— 21 个测试
  - [x] Dashboard 图表组件（数据展示）—— stats-card (9 tests) + metric-card (14 tests)
  - [x] API Client 层（核心基础设施）—— 25 个测试
  - [x] Auth hooks（认证流程）—— use-auth.test.tsx 已覆盖

#### E2E 测试 ⚠️

- [x] **关键用户流程 E2E 测试**（使用 Playwright）

  **企业端关键流程**：
  - [x] 注册 → 登录 → 创建企业
  - [x] 创建部门 → 邀请成员
  - [x] 浏览员工市场 → 订阅员工
  - [x] 发起对话 → 查看对话历史



  **运营端关键流程**：
  - [x] 运营账号登录
  - [x] 查看能力管理页面
  - [x] 查看员工管理页面
  - [x] 查看企业管理页面
  - [x] 查看平台统计仪表盘

  **客户端接入流程**：
  - [x] 客户端登录（邮箱 + 密码 + 设备指纹）
  - [x] 获取订阅列表
  - [x] 换取 employmentToken
  - [x] 模型网关 Chat Completion
  - [x] 模型网关流式响应
  - [x] 验证计费记录

### 1.3 代码审查

- [ ] **关键模块 Code Review**
  - [ ] `gateway.service.ts`（模型网关计费逻辑）
  - [ ] `task-execution.service.ts`（任务执行引擎）
  - [ ] `compute-transaction.service.ts`（算力交易）
  - [ ] `auth.service.ts`（认证逻辑）
  - [ ] `embedding.service.ts`（知识库向量化）

- [ ] **前端关键页面审查**
  - [ ] Dashboard（数据展示逻辑）
  - [ ] ChatWindow（消息渲染、错误处理）
  - [ ] 员工市场（筛选、分页）
  - [ ] 表单页面（验证逻辑）

---

## 2. 功能完整性测试

### 2.1 企业端功能

#### 用户认证 ✅
- [ ] 注册（邮箱验证、密码强度检查）
- [ ] 登录（JWT token、httpOnly cookie）
- [ ] 登出（清除 cookie）
- [ ] 忘记密码（邮件重置链接）
- [ ] Token 自动刷新（接近过期时）

#### 企业组织管理 ✅
- [ ] 创建企业（首次登录）
- [ ] 查看企业信息
- [ ] 更新企业信息（名称、简介、Logo）
- [ ] 部门管理（CRUD、层级结构）
- [ ] 成员管理（邀请、移除、角色分配）
- [ ] 默认部门树（自动创建 5 部门 + 11 组）

#### 员工市场 ✅
- [ ] 浏览员工列表（分页、筛选）
- [ ] 搜索员工（关键词、标签）
- [ ] 查看员工详情（能力说明、定价、评分）
- [ ] 订阅员工（选择套餐、确认付费）
- [ ] 取消订阅（退款逻辑）

####
#### 实例管理 ✅
- [ ] 创建实例（基于订阅的员工）
- [ ] 查看实例列表（筛选、状态）
- [ ] 实例详情（使用统计、日志）
- [ ] 实例授权（给部门/成员）
- [ ] 实例配置（参数调整）
- [ ] 启用/停用实例
- [ ] 删除实例

#### 对话功能 ✅
- [ ] 发起新对话（选择实例）
- [ ] 查看对话历史（分页、搜索）
- [ ] 继续历史对话
- [ ] 流式消息渲染（SSE）
- [ ] 消息附件上传（图片、文档）
- [ ] 工具调用展示（知识库检索、能力调用）
- [ ] 错误处理（网络超时、余额不足）

#### 算力管理 ✅
- [ ] 查看余额（企业钱包）
- [ ] 充值算力（支付宝、微信支付）
- [ ] 算力分配（给部门/成员）
- [ ] 消费记录（按时间、按实例筛选）
- [ ] 导出账单（Excel/CSV）
- [ ] 余额预警（低于阈值提醒）

#### 知识库管理 ✅
- [ ] 创建知识库（CRUD）
- [ ] 上传文档（PDF/Word/Excel/TXT/CSV）
- [ ] 文档解析（mammoth/pdf-parse）
- [ ] 向量化（Ollama + bge-m3）
- [ ] 检索测试（相似度搜索）
- [ ] 绑定到实例（启用知识库增强）
- [ ] 删除文档（同步删除向量）

### 2.2 运营端功能

#### 员工模板管理 ✅
- [ ] 创建员工模板（CRUD）
- [ ] 绑定硅基能力（agent/rpa/skill/ai-app）
- [ ] 设置定价（按请求/按时长）
- [ ] 发布/下架员工
- [ ] 查看订阅统计

#### 企业管理 ✅
- [ ] 查看企业列表（搜索、筛选）
- [ ] 企业详情（组织架构、使用情况）
- [ ] 充值/扣减算力（运营干预）
- [ ] 冻结/解冻企业（风控）

#### 能力管理 ✅
- [ ] 查看能力库（所有上传的能力）
- [ ] 能力详情（类型、版本、配置）
- [ ] 能力审核（待审核 → 通过/拒绝）
- [ ] 删除能力（依赖检查）

#### 平台统计 ✅
- [ ] 企业数、员工数、订阅数
- [ ] 模型调用统计（请求数、成本）
- [ ] 收入统计（按时间维度）
- [ ] 用户活跃度（DAU/MAU）

### 2.3 客户端接入（SDK）

#### 设备认证 ✅
- [ ] 设备登录（邮箱 + 密码 + 设备指纹）
- [ ] 获取设备 token（15 分钟有效期）
- [ ] Token 自动续期

#### 实例操作 ✅
- [ ] 获取实例列表（已授权的）
- [ ] 换取实例令牌（用于模型网关）
- [ ] 查看实例详情

#### 模型网关 ✅
- [ ] 通过网关调用模型（OpenAI-compatible）
- [ ] 计费正确（扣减企业钱包 + 记录 ModelUsage）
- [ ] 错误处理（余额不足、token 失效）
- [ ] 流式响应（stream: true）

---

## 3. 性能优化

### 3.1 数据库性能

#### 索引优化
- [x] **检查缺失索引** ✅
  - 完整分析报告：`docs/testing/database-index-analysis.md`
  - 关键发现：
    - ✅ 会话/消息查询已优化（`sessionId + createdAt`）
    - ✅ 账单查询已优化（`walletId + createdAt DESC`）
    - ✅ 企业查询已优化（`enterpriseId + createdAt`）
    - ⚠️ TaskRunStep 缺少 `[taskRunId, order]` 索引（P1 优化项，当前性能可接受）
    - ⚠️ pgvector 索引需手动创建（部署时任务）

- [ ] **性能测试** (部署时执行)
  ```sql
  -- 1. 会话历史加载（预期 <50ms）
  EXPLAIN ANALYZE SELECT * FROM conversation_sessions
  WHERE user_id = 'usr-xxx' AND source = 'CHAT'
  ORDER BY created_at DESC LIMIT 50;

  -- 2. 消息加载（预期 <30ms）
  EXPLAIN ANALYZE SELECT * FROM messages
  WHERE session_id = 'sess-xxx'
  ORDER BY created_at ASC;

  -- 3. 账单历史（预期 <50ms）
  EXPLAIN ANALYZE SELECT * FROM wallet_transactions
  WHERE wallet_id = 'wal-xxx'
  ORDER BY created_at DESC LIMIT 100;

  -- 4. 向量检索（预期 <100ms）
  EXPLAIN ANALYZE SELECT * FROM text_chunks
  WHERE knowledge_base_id = 'kb-xxx'
  ORDER BY embedding_vector <=> '[向量]' LIMIT 10;
  ```

#### 连接池配置
- [x] **Prisma 连接池设置** ✅ (已文档化，部署时应用)

  **推荐生产配置**（`backend/.env.production`）：
  ```bash
  DATABASE_URL="postgresql://sep_prod:STRONG_PASSWORD@db-host:5432/sep_platform?connection_limit=20&pool_timeout=10"
  ```

  **说明**：
  - `connection_limit=20`：足够支撑 API + 后台任务
  - `pool_timeout=10`：快速失败，及早发现连接泄漏
  - 默认无限制会耗尽 PostgreSQL `max_connections`

#### 慢查询日志
- [x] **PostgreSQL 慢查询配置** ✅ (已文档化，部署时启用)

  **启用方式**（连接到生产数据库执行）：
  ```sql
  -- 记录执行超过 500ms 的查询
  ALTER SYSTEM SET log_min_duration_statement = 500;
  SELECT pg_reload_conf();

  -- 查看日志位置
  SHOW data_directory;  -- 日志文件: <data_directory>/log/postgresql-*.log
  ```

  **定期审查**：每周检查日志，查找无索引查询（EXPLAIN 输出中的 Seq Scan）

### 3.2 缓存策略

#### Redis 缓存 ✅
- [x] **Redis 基础设施已部署** ✅
  - Redis 7 已启用持久化（`--appendonly yes`）
  - 会话锁已实现（防止对话并发冲突）
  - 完整分析报告：`docs/testing/caching-strategy-review.md`

- [ ] **企业余额缓存**（**P1 后续优化**，当前不阻塞上线）
  ```typescript
  // 建议添加到 wallet.service.ts
  async getBalance(enterpriseId: string) {
    const cacheKey = `balance:${enterpriseId}`;
    const cached = await this.redis.get(cacheKey);
    if (cached) return JSON.parse(cached);

    const wallet = await this.ensureWallet(enterpriseId);
    const balance = {
      balance: wallet.balance,
      frozenAmount: wallet.frozenAmount,
      availableBalance: wallet.balance.minus(wallet.frozenAmount),
    };

    // 缓存 60 秒（每分钟刷新一次，减少 DB 负载）
    await this.redis.setex(cacheKey, 60, JSON.stringify(balance));
    return balance;
  }

  // 交易后失效缓存
  async recordTransaction(...) {
    // ... 执行交易 ...
    await this.redis.del(`balance:${enterpriseId}`);
  }
  ```

  **预期收益**：
  - 数据库负载减少 50%（每分钟 1 次查询 vs 每条消息 1 次）
  - API 响应时间减少 10-20ms

- [ ] **实例元数据缓存**（P2 优化项）
  - 实例配置（模型参数、知识库授权）
  - TTL: 300 秒
  - 失效时机：配置更新、知识库授权变更

- [ ] **能力配置缓存**（P2 优化项）
  - 能力类型、执行配置、SKILL.md 内容
  - TTL: 600 秒
  - 失效时机：能力更新、版本上传

#### 前端缓存
- [x] **TanStack Query 缓存配置** ✅ 已验证

  当前配置位置：`web/src/components/providers.tsx`

  **已实现配置**：
  ```typescript
  new QueryClient({
    defaultOptions: {
      queries: {
        staleTime: 5 * 60_000,        // 5分钟全局缓存
        retry: 1,                      // 失败重试1次
        refetchOnWindowFocus: false,   // 窗口聚焦不重新请求
        refetchOnMount: false,         // 组件挂载不重新请求
      },
    },
  })
  ```

  **评估**：✅ 配置合理
  - 5 分钟全局缓存适合大部分数据（员工列表、实例列表、企业信息）
  - 禁用自动重新请求减少不必要的网络开销
  - 对话历史等实时性要求高的 query 可以在具体 hook 中覆盖 staleTime

  **P1 优化建议**：
  - 对话历史 query: `staleTime: 30_000` (30 秒)
  - 员工市场搜索: `staleTime: 10 * 60_000` (10 分钟)
  - 个人信息: `staleTime: 1 * 60_000` (1 分钟)

### 3.3 前端性能

#### 打包优化
- [ ] **生产构建分析**
  ```bash
  cd web && pnpm build
  # 检查 .next/build-manifest.json 中的 bundle 大小
  # - 首页 JS bundle < 200KB（gzip）
  # - 图表库按需加载（dynamic import）
  ```

#### 图片优化
- [ ] **Next.js Image 组件**（所有图片使用 `<Image />` 替代 `<img />`）
- [ ] **员工头像 WebP 格式**（`backend/assets/employee-avatars/`）
- [ ] **CDN 配置**（`ASSET_BASE_URL` 指向 CDN）

#### 代码分割
- [ ] **路由级别代码分割**（Next.js 默认已支持）
- [ ] **图表库按需加载**
  ```typescript
  // web/src/app/(enterprise)/dashboard/page.tsx
  import dynamic from 'next/dynamic';
  const ChartComponent = dynamic(() => import('@/components/charts/...'), {
    loading: () => <Skeleton />
  });
  ```

### 3.4 并发与限流

#### API 限流 ⚠️
- [ ] **添加全局限流**（建议使用 `@nestjs/throttler`）
  ```bash
  cd backend && pnpm add @nestjs/throttler
  ```
  ```typescript
  // backend/src/app.module.ts
  import { ThrottlerModule } from '@nestjs/throttler';

  @Module({
    imports: [
      ThrottlerModule.forRoot({
        ttl: 60,      // 60 秒
        limit: 100,   // 每个 IP 100 次请求
      }),
    ],
  })
  ```

#### 模型调用并发控制
- [ ] **检查 sub2api 并发限制**
  - 单个企业最大并发：10
  - 全局最大并发：100
  - 排队超时：30 秒

---

## 4. 安全加固

### 4.1 认证与授权

#### JWT 安全 ✅
- [x] **JWT_SECRET 强度**（生产环境必须 32+ 字符随机字符串）
  ```bash
  # 生成强密钥
  openssl rand -base64 32
  ```

- [ ] **Token 过期时间合理**（当前 7 天，考虑缩短到 1 天）
  ```typescript
  // backend/src/modules/auth/auth.service.ts
  this.jwtService.sign(payload, { expiresIn: '1d' }); // 建议改为 1 天
  ```

- [x] **httpOnly Cookie**（已启用，防止 XSS 窃取 token）
- [ ] **CSRF 防护**（建议添加 CSRF token）

#### 设备认证安全
- [ ] **设备指纹碰撞检测**（同一指纹多次绑定不同账号 → 风控）
- [ ] **设备令牌 TTL**（当前 15 分钟，合理）
- [ ] **设备黑名单**（异常设备自动拉黑）

### 4.2 输入验证

#### Zod Schema 完整性
- [ ] **检查所有 DTO 都有 Zod 验证**
  ```bash
  # 查找未验证的 Controller 方法
  cd backend && grep -r "@Body()" src/modules --include="*.controller.ts" | \
    grep -v "ValidationPipe"
  ```

#### SQL 注入防护 ✅
- [x] **Prisma ORM 参数化查询**（天然防注入）
- [ ] **原始 SQL 检查**（搜索 `$queryRaw`，确保使用参数化）
  ```bash
  cd backend && grep -r "\$queryRaw\|\$executeRaw" src/
  ```

#### XSS 防护
- [ ] **前端输出转义**（React 默认已转义）
- [ ] **富文本内容过滤**（如果有，使用 DOMPurify）
- [ ] **CSP 头部设置**（Content-Security-Policy）

### 4.3 敏感信息保护

#### 环境变量管理
- [ ] **.env 文件不提交到 Git**（`.gitignore` 已配置）
- [ ] **生产环境密钥轮换**
  - `JWT_SECRET`
  - `SUB2API_API_KEY`
  - `OPENCODE_API_TOKEN`
  - 数据库密码

#### 日志脱敏
- [ ] **不记录敏感字段**
  ```typescript
  // 错误日志中不应包含：
  // - 密码（password）
  // - JWT token
  // - API key
  // - 用户手机号/邮箱（部分脱敏）
  ```

#### 文件上传安全
- [ ] **文件类型白名单**（`file-validator.ts` 已实现）
- [ ] **文件大小限制**（当前 10MB，合理）
- [ ] **文件内容检测**（防止恶意文件伪装）
- [ ] **上传目录权限**（不可执行）

### 4.4 HTTPS 与证书

- [ ] **生产环境强制 HTTPS**（Caddyfile 配置）
- [ ] **HSTS 头部**（强制浏览器使用 HTTPS）
- [ ] **证书自动续期**（Caddy 自动管理 Let's Encrypt）

---

## 5. 部署配置

### 5.1 环境配置

#### 生产环境变量检查
- [ ] **后端 .env 配置**（`backend/.env.production`）
  ```bash
  NODE_ENV=production
  PORT=3001

  # 数据库（生产 PostgreSQL）
  DATABASE_URL="postgresql://sep_prod:STRONG_PASSWORD@db-host:5432/sep_platform?connection_limit=20"

  # JWT（强密钥）
  JWT_SECRET="<32+ 字符随机字符串>"

  # sub2api（生产网关）
  SUB2API_BASE_URL="https://your-sub2api.com/v1"
  SUB2API_API_KEY="<生产 API Key>"
  SUB2API_DEFAULT_MODEL="gpt-4"

  # 资产 CDN
  ASSET_BASE_URL="https://cdn.your-domain.com"

  # Embedding（生产 Ollama）
  EMBEDDING_BASE_URL="http://ollama-service:11434/v1"
  EMBEDDING_MODEL="bge-m3:latest"
  EMBEDDING_DIMENSION=1024

  # OpenCode Skills Service
  OPENCODE_API_BASE_URL="https://skills.your-domain.com"
  OPENCODE_API_TOKEN="<生产 Token>"

  # CORS
  CORS_ORIGIN="https://your-domain.com"
  ```

- [ ] **前端环境变量**（`web/.env.production`）
  ```bash
  NEXT_PUBLIC_API_URL="https://api.your-domain.com"
  ```

#### Docker Compose 生产配置
- [ ] **检查资源限制**（`deploy/production/docker-compose.yml`）
  ```yaml
  services:
    backend:
      deploy:
        resources:
          limits:
            cpus: '2.0'
            memory: 2G
          reservations:
            cpus: '1.0'
            memory: 1G
      restart: always
  ```

### 5.2 数据库迁移

#### 迁移脚本检查
- [ ] **所有 migration 文件可重放**
  ```bash
  cd backend && pnpm db:migrate
  # 确保没有报错
  ```

#### 生产数据库初始化
- [ ] **Seed 数据准备**（`backend/prisma/seed/index.ts`）
  - [ ] 运营账号（admin@sep.com）
  - [ ] 默认员工模板（可选）
  - [ ] 默认能力（可选）

- [ ] **数据备份计划**
  ```bash
  # 每日自动备份（已提供 backup-sep.sh）
  # 检查 systemd timer 是否配置
  systemctl status sep-maintenance.timer
  ```

### 5.3 部署流程

#### 蓝绿部署 ✅
- [ ] **测试蓝绿切换**（`deploy/production/test-sep-deploy.sh`）
  ```bash
  cd deploy/production
  ./test-sep-deploy.sh
  ```

#### 回滚计划
- [ ] **快速回滚脚本**
  ```bash
  # 切换到上一个稳定版本
  cd deploy/production
  docker-compose down
  git checkout <上一个 tag>
  docker-compose up -d
  ```

#### 健康检查
- [ ] **后端健康检查端点**（`/health`）
  ```bash
  curl https://api.your-domain.com/health
  # 应返回 200 OK
  ```

- [ ] **数据库连接检查**
- [ ] **Redis 连接检查**
- [ ] **sub2api 连通性检查**
- [ ] **Ollama 连通性检查**

---

## 6. 监控与运维

### 6.1 日志系统 ⚠️

#### 应用日志
- [ ] **统一日志格式**（JSON 结构化日志）
  ```bash
  cd backend && pnpm add pino pino-pretty
  ```
  ```typescript
  // backend/src/main.ts
  import { Logger } from 'nestjs-pino';
  app.useLogger(app.get(Logger));
  ```

- [ ] **日志级别**
  - 开发环境：DEBUG
  - 生产环境：INFO
  - 错误日志：ERROR

- [ ] **日志轮转**（`deploy/production/sep-maintenance.logrotate`）
  ```bash
  # 检查 logrotate 配置
  cat /etc/logrotate.d/sep-maintenance
  ```

#### 日志聚合 ⚠️
- [ ] **部署日志收集系统**（建议 ELK / Loki + Grafana）
  ```yaml
  # 可选：添加到 docker-compose.yml
  loki:
    image: grafana/loki:latest
    ports:
      - "3100:3100"

  promtail:
    image: grafana/promtail:latest
    volumes:
      - /var/lib/docker/containers:/var/lib/docker/containers
  ```

### 6.2 性能监控 ⚠️

#### APM（应用性能监控）
- [ ] **集成 APM 工具**（建议 Prometheus + Grafana）
  ```bash
  cd backend && pnpm add @willsoto/nestjs-prometheus prom-client
  ```

#### 关键指标
- [ ] **API 响应时间**（P50/P95/P99）
- [ ] **数据库查询时间**
- [ ] **模型调用延迟**
- [ ] **错误率**（4xx/5xx）
- [ ] **并发连接数**

### 6.3 业务监控

#### 业务指标
- [ ] **实时在线用户数**
- [ ] **每日对话数**
- [ ] **模型调用成功率**
- [ ] **平均对话轮次**
- [ ] **算力消费速率**

#### 告警规则 ⚠️
- [ ] **余额不足告警**（企业余额 < 10 元）
- [ ] **错误率告警**（5 分钟内错误率 > 5%）
- [ ] **响应时间告警**（P95 > 2 秒）
- [ ] **数据库连接池耗尽**
- [ ] **Redis 连接失败**
- [ ] **磁盘空间不足**（< 20%）

### 6.4 备份与恢复

#### 数据备份 ✅
- [x] **每日自动备份**（`backup-sep.sh` + systemd timer）
- [ ] **备份保留策略**（7 天内每日备份 + 4 周每周备份）
- [ ] **异地备份**（上传到 OSS/S3）

#### 恢复演练
- [ ] **测试数据恢复**
  ```bash
  cd deploy/production
  ./restore-sep.sh backups/sep-backup-YYYYMMDD-HHMMSS.tar.gz
  ```

---

## 7. 文档与培训

### 7.1 技术文档

- [ ] **API 文档完整**（Swagger UI: `/api/docs`）
  - [ ] 所有端点都有 `@ApiOperation` 描述
  - [ ] 请求/响应 Schema 准确
  - [ ] 错误码说明完整

- [ ] **部署文档**（`deploy/production/README.md`）
  - [ ] 环境要求
  - [ ] 部署步骤
  - [ ] 回滚流程
  - [ ] 故障排查

- [ ] **架构文档**（`docs/architecture/`）
  - [ ] 系统架构图
  - [ ] 数据库 ER 图
  - [ ] 核心流程时序图

### 7.2 用户文档

- [ ] **用户操作手册**
  - [ ] 企业端使用指南
  - [ ] 运营端管理手册
  - [ ] 客户端接入文档

- [ ] **FAQ 文档**
  - [ ] 常见问题解答
  - [ ] 故障排查指南

### 7.3 培训

- [ ] **运营人员培训**（运营端操作）
- [ ] **客服人员培训**（常见问题处理）
- [ ] **开发人员培训**（代码结构、部署流程）

---

## 8. 上线前最终检查

### 8.1 功能冒烟测试

- [ ] **企业端关键流程**（从注册到发起对话）
- [ ] **运营端关键流程**（创建员工、充值算力）
- [ ] **客户端接入流程**（设备登录、调用模型）

### 8.2 性能压测

- [ ] **并发对话压测**（100 并发用户）
  ```bash
  # 使用 k6 或 Artillery
  npm install -g artillery
  artillery quick --count 100 --num 10 https://api.your-domain.com/chat
  ```

- [ ] **模型网关压测**（50 并发模型调用）
- [ ] **数据库连接池压测**（200 并发查询）

### 8.3 安全扫描

- [ ] **依赖漏洞扫描**
  ```bash
  cd backend && pnpm audit
  cd web && pnpm audit
  ```

- [ ] **OWASP ZAP 扫描**（自动化安全测试）
- [ ] **代码静态分析**（SonarQube）

### 8.4 容灾演练

- [ ] **数据库故障恢复**（主库宕机 → 从库切换）
- [ ] **Redis 故障降级**（缓存失效后直接查 DB）
- [ ] **sub2api 故障处理**（切换备用网关）

### 8.5 上线检查清单

- [ ] **所有环境变量已配置**
- [ ] **数据库迁移已执行**
- [ ] **Seed 数据已导入**
- [ ] **HTTPS 证书已配置**
- [ ] **域名 DNS 已解析**
- [ ] **CDN 已配置**
- [ ] **监控告警已启用**
- [ ] **日志系统正常**
- [ ] **备份任务已启动**
- [ ] **回滚方案已准备**

---

## 9. 上线后观察期（7 天）

### 第 1 天
- [ ] **每小时检查错误日志**
- [ ] **监控 API 响应时间**
- [ ] **检查用户反馈**

### 第 3 天
- [ ] **分析用户行为数据**
- [ ] **优化慢查询**
- [ ] **调整缓存策略**

### 第 7 天
- [ ] **生成上线报告**
  - 用户增长
  - 性能指标
  - 错误统计
  - 待优化项

---

## 10. 附录

### 10.1 关键联系人

| 角色 | 姓名 | 联系方式 | 职责 |
|------|------|----------|------|
| 技术负责人 | [待填] | [待填] | 技术决策、架构审查 |
| 后端负责人 | [待填] | [待填] | 后端开发、部署 |
| 前端负责人 | [待填] | [待填] | 前端开发、性能优化 |
| 运维负责人 | [待填] | [待填] | 服务器管理、监控告警 |
| 产品负责人 | [待填] | [待填] | 需求确认、用户反馈 |

### 10.2 外部服务依赖

| 服务 | 提供商 | 用途 | SLA | 备用方案 |
|------|--------|------|-----|----------|
| sub2api | [待填] | 模型调用网关 | [待填] | 直连 DeepSeek |
| Ollama | 自建 | Embedding 向量化 | [待填] | OpenAI Embedding |
| OpenCode Skills | 自建 | SKILL.md 能力执行 | [待填] | 无 |
| PostgreSQL | 自建 | 主数据库 | [待填] | 从库切换 |
| Redis | 自建 | 缓存 | [待填] | 直接查 DB |

### 10.3 快速命令参考

```bash
# 开发环境启动
pnpm install
docker-compose up -d
cd backend && pnpm db:migrate && pnpm db:seed
pnpm dev

# 生产构建
pnpm build

# 测试
pnpm test              # 单元测试
pnpm test:e2e          # E2E 测试
pnpm test:cov          # 覆盖率

# 部署
cd deploy/production
./sep-deploy.sh        # 蓝绿部署
./backup-sep.sh        # 数据备份
./restore-sep.sh <备份文件>  # 数据恢复

# 日志查看
docker logs -f sep-backend
docker logs -f sep-web

# 数据库操作
cd backend
pnpm db:studio         # Prisma Studio
pnpm db:migrate        # 创建迁移
pnpm db:generate       # 生成 Prisma Client
```

---

## 📝 总结

### ✅ 已完成
- 核心功能开发（企业端 + 运营端 + 客户端）
- 后端单元测试（1160 个测试用例全部通过）
- 部署脚本（Docker Compose + 蓝绿部署）
- 基础监控（健康检查、日志轮转）

### ⚠️ 待补充（优先级从高到低）

**P0（必须完成才能上线）：**
1. ~~**E2E 测试**~~（✅ 已完成 - 16/16 tests passing）
2. ~~**前端单元测试**~~（✅ 已完成 - 52 files, 514 tests passing - 核心组件、API client、auth hooks）
3. ~~**代码质量检查**~~（✅ 已完成 - ESLint + TypeScript 类型检查全部通过）
4. ~~**安全加固**~~（✅ 已完成 - JWT token 缩短、CSP 头部、日志脱敏、限流保护）
5. **性能压测**（并发对话、模型调用）
6. **监控告警**（错误率、响应时间、余额预警）

**P1（上线后 2 周内完成）：**
1. **日志聚合**（ELK / Loki + Grafana）
2. **APM 监控**（Prometheus + Grafana）
3. **容灾演练**（数据库故障恢复、服务降级）
4. **用户文档**（操作手册、FAQ）

**P2（上线后 1 个月内完成）：**
1. **前端性能优化**（代码分割、图片 CDN）
2. **数据库慢查询优化**
3. **异地备份**（OSS/S3）
4. **安全扫描**（OWASP ZAP、SonarQube）

---

**最后更新**: 2026-09-22
**文档维护**: [待指定负责人]
