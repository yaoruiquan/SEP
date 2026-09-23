# E2E 测试文档

## 概述

E2E（End-to-End）测试覆盖硅基员工平台的三大核心流程：

1. **企业端流程**：注册 → 登录 → 订阅员工 → 发起对话
2. **运营端流程**：登录 → 创建员工模板 → 配置能力 → 发布
3. **客户端 SDK 流程**：设备登录 → 模型网关调用 → 计费验证

## 技术栈

- **框架**：Playwright
- **浏览器**：Chromium
- **运行模式**：单线程顺序执行（避免数据库并发冲突）

## 前置条件

### 1. 启动本地服务

```bash
# 终端 1：启动后端服务
cd backend
pnpm dev

# 终端 2：启动前端服务
cd web
pnpm dev

# 终端 3（可选）：运行 E2E 测试
cd web
pnpm test:e2e
```

### 2. 数据库准备

```bash
# 确保数据库已迁移
cd backend
pnpm db:migrate

# 初始化种子数据（运营管理员账号）
pnpm db:seed
```

### 3. 环境变量

确保 `.env` 文件配置正确：

```bash
# 后端
DATABASE_URL="postgresql://..."
REDIS_URL="redis://localhost:6379"
SUB2API_BASE_URL="http://..."
SUB2API_API_KEY="sk-..."

# 前端
NEXT_PUBLIC_API_URL="http://localhost:4000/api"
```

## 运行测试

### 基本命令

```bash
# 运行所有 E2E 测试
pnpm test:e2e

# 以 UI 模式运行（可视化调试）
pnpm test:e2e:ui

# 以 headed 模式运行（查看浏览器操作）
pnpm test:e2e:headed

# Debug 模式（逐步执行）
pnpm test:e2e:debug

# 查看测试报告
pnpm test:e2e:report
```

### 运行单个测试文件

```bash
# 仅运行企业端流程测试
pnpm test:e2e e2e/enterprise-flow.spec.ts

# 仅运行运营端流程测试
pnpm test:e2e e2e/platform-flow.spec.ts

# 仅运行客户端 SDK 测试
pnpm test:e2e e2e/client-sdk.spec.ts
```

### CI/CD 环境

```bash
# CI 环境下运行（带重试）
CI=true pnpm test:e2e

# 跳过自动启动本地服务（服务已在其他进程运行）
SKIP_WEB_SERVER=true pnpm test:e2e
```

## 测试文件结构

```
web/
├── e2e/
│   ├── enterprise-flow.spec.ts   # 企业端核心流程（5个测试）
│   ├── platform-flow.spec.ts     # 运营端核心流程（6个测试）
│   ├── client-sdk.spec.ts        # 客户端SDK流程（6个测试）
│   └── helpers.ts                # 测试辅助函数
├── playwright.config.ts          # Playwright 配置
└── playwright-report/            # 测试报告（自动生成）
```

## 测试覆盖范围

### 企业端流程（enterprise-flow.spec.ts）

| 测试用例 | 覆盖功能 | 验证点 |
|---------|---------|--------|
| 1. 企业注册流程 | 用户注册 | 表单提交 → 跳转成功 |
| 2. 企业登录流程 | 用户登录 | 登录 → Dashboard 显示 |
| 3. 浏览员工市场 | 员工列表 | 市场页加载 → 员工卡片显示 |
| 4. 订阅硅基员工 | 创建订阅 | 订阅流程 → 我的员工列表 |
| 5. 发起对话 | 对话系统 | 发送消息 → AI 回复 |

### 运营端流程（platform-flow.spec.ts）

| 测试用例 | 覆盖功能 | 验证点 |
|---------|---------|--------|
| 1. 运营管理员登录 | 管理员认证 | 登录 → 运营后台 |
| 2. 创建员工模板 | 员工管理 | 创建表单 → 列表显示 |
| 3. 配置员工能力 | 能力绑定 | 添加能力 → 配置保存 |
| 4. 发布员工模板 | 状态管理 | 发布操作 → 状态更新 |
| 5. 查看企业列表 | 企业管理 | 列表加载 → 数据显示 |
| 6. 查看平台统计 | 数据看板 | 统计指标 → 图表渲染 |

### 客户端 SDK 流程（client-sdk.spec.ts）

| 测试用例 | 覆盖功能 | 验证点 |
|---------|---------|--------|
| 1. 获取企业 API 密钥 | API 认证 | 密钥生成 → 格式验证 |
| 2. 设备登录 | 设备认证 | 设备注册 → Token 获取 |
| 3. 模型网关调用 | OpenAI 兼容接口 | 请求成功 → 响应格式 |
| 4. 流式响应 | SSE 流式输出 | Stream 返回 → 格式验证 |
| 5. 查询余额和用量 | 计费查询 | 余额接口 → 用量接口 |
| 6. 设备登出 | Token 失效 | 登出 → 认证失败 |

## 调试技巧

### 1. 使用 UI 模式

```bash
pnpm test:e2e:ui
```

UI 模式提供：
- 可视化测试执行
- 逐步调试
- 元素选择器工具
- 网络请求查看

### 2. 使用 headed 模式

```bash
pnpm test:e2e:headed
```

查看实际浏览器操作过程，适合定位交互问题。

### 3. 截图和视频

测试失败时自动保存：
- 截图：`test-results/*/test-failed-*.png`
- 视频：`test-results/*/video.webm`

### 4. 查看 trace

```bash
# 查看失败测试的 trace
pnpm exec playwright show-trace test-results/.../trace.zip
```

Trace 包含：
- 完整操作记录
- 网络请求/响应
- 控制台日志
- 元素快照

## 常见问题

### Q1: 测试超时

**原因**：服务未启动或响应慢

**解决**：
```bash
# 检查后端服务
curl http://localhost:4000/api/health

# 检查前端服务
curl http://localhost:3000

# 增加超时时间（playwright.config.ts）
timeout: 60 * 1000
```

### Q2: 元素找不到

**原因**：DOM 结构变化或加载慢

**解决**：
```typescript
// 增加 waitFor
await element.waitFor({ state: 'visible', timeout: 10000 });

// 使用更稳定的选择器
page.getByRole('button', { name: '确认' })
page.getByTestId('submit-button')
```

### Q3: 数据库状态冲突

**原因**：多个测试修改同一数据

**解决**：
```typescript
// 每个测试使用唯一标识
const testId = `test-${Date.now()}-${Math.random()}`;

// 或在 afterEach 清理数据
test.afterEach(async () => {
  await cleanupTestData();
});
```

### Q4: API 密钥测试失败

**原因**：密钥只在创建时返回完整值

**解决**：
```typescript
// 保存创建时的完整密钥
const keyData = await createApiKey();
apiKey = keyData.key; // 而非从列表获取
```

## 持续集成

### GitHub Actions 示例

```yaml
name: E2E Tests

on: [push, pull_request]

jobs:
  e2e:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v3
      - uses: actions/setup-node@v3
        with:
          node-version: '20'
      
      - name: Install dependencies
        run: pnpm install
      
      - name: Start services
        run: |
          docker-compose up -d
          pnpm db:migrate
          pnpm db:seed
      
      - name: Run E2E tests
        run: CI=true pnpm test:e2e
      
      - name: Upload report
        if: always()
        uses: actions/upload-artifact@v3
        with:
          name: playwright-report
          path: web/playwright-report/
```

## 最佳实践

1. **测试隔离**：每个测试独立运行，不依赖其他测试的状态
2. **使用 data-testid**：为关键元素添加测试专用属性
3. **等待策略**：优先使用 `waitForURL` 和 `waitFor`，避免硬编码 `waitForTimeout`
4. **错误信息**：失败时提供清晰的错误上下文
5. **清理数据**：测试后清理创建的测试数据
6. **并发控制**：涉及数据库的测试使用单线程执行

## 维护指南

### 新增测试用例

1. 在对应的 spec 文件中添加 `test()` 块
2. 使用 `helpers.ts` 中的辅助函数
3. 确保测试可以独立运行
4. 更新本文档的测试覆盖范围表格

### 更新测试数据

如果页面结构变化：
1. 运行 `pnpm test:e2e:ui` 使用选择器工具
2. 更新选择器为更稳定的方式（role > testId > text > CSS）
3. 验证所有相关测试通过

### 调整超时时间

根据实际响应时间调整：
```typescript
// 全局配置（playwright.config.ts）
timeout: 30 * 1000

// 单个测试
test.setTimeout(60 * 1000);
```
