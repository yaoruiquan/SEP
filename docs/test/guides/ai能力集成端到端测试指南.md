# 硅基人才平台 (SEP) — 端到端测试指南

> **版本**: v1.0  
> **更新时间**: 2026-07-23  
> **适用范围**: 开发环境本地测试、演示验收

---

## 一、测试环境准备

### 1.1 前置依赖检查

在开始测试前,确保以下服务全部运行:

```bash
# 检查 Docker 容器状态
docker ps --format "table {{.Names}}\t{{.Status}}\t{{.Ports}}"

# 必需容器(全部 Up 且 healthy):
#   sep-postgres       (PostgreSQL 16)
#   sep-redis          (Redis 7)
```

**预期输出**:
```
NAMES            STATUS                  PORTS
sep-postgres     Up X hours (healthy)    0.0.0.0:5432->5432/tcp
sep-redis        Up X hours (healthy)    0.0.0.0:6379->6379/tcp
```

如果容器未启动:
```bash
docker-compose up -d
```

### 1.2 环境变量确认

检查 `.env` 文件关键配置:

```bash
grep -E "^(DATABASE_URL|SUB2API_BASE_URL|SUB2API_API_KEY|SUB2API_DEFAULT_MODEL|COZE_PAT|PORT|CORS_ORIGIN)" .env
```

**必需配置**:
- `DATABASE_URL`: PostgreSQL 连接串(默认 `postgresql://sep:sep_dev_password@localhost:5432/sep_platform`)
- `SUB2API_BASE_URL`: sub2api 中转站地址(默认 `https://longdaoai.cn/v1`)
- `SUB2API_API_KEY`: sub2api 凭据(形如 `sk-xxx`,**必须有效**)
- `SUB2API_DEFAULT_MODEL`: 默认模型 ID(应为 `deepseek-v4-flash`)
- `COZE_PAT`: Coze Personal Access Token(可选,导入 Coze 能力时需要)
- `PORT`: 后端端口(默认 `3001`)
- `CORS_ORIGIN`: 前端地址白名单(默认 `http://localhost:3000`)

⚠️ **关键**: `SUB2API_API_KEY` 必须真实有效,否则 AI 对话会失败(`model_not_found` / `401`)。

### 1.3 数据库初始化

首次运行或需要重置数据时:

```bash
# 完整重置(删除所有数据 + 重建表 + 填充演示数据)
pnpm db:reset

# 仅填充演示数据(不删除现有数据,幂等)
pnpm db:seed
```

**演示账号**:
| 角色 | 邮箱 | 密码 | 说明 |
|------|------|------|------|
| 管理员 | `admin@sep.local` | `Demo123456` | 可审核能力、管理员工 |
| 普通用户 | `user@sep.local` | `Demo123456` | 已订阅「小海」员工 |

**演示数据**:
- **3 个数字员工**(小海/阿析/小文),状态 `PUBLISHED`,可直接订阅
- **4 个能力**(联网搜索/营销文案/报表抓取/数据看板),涵盖 `AGENT`/`SKILL`/`RPA`/`AI_APP` 四种类型
- **1 个订阅**: `user@sep.local` 已订阅「小海」

### 1.4 启动服务

**终端 1 — 后端**:
```bash
pnpm dev:backend
```
预期输出:
```
[Nest] INFO [NestApplication] Nest application successfully started
```
访问 `http://localhost:3001/api/docs` 验证 Swagger 可访问。

**终端 2 — 前端**:
```bash
pnpm dev:web
```
预期输出:
```
- Local:   http://localhost:3000
```

---

## 二、端到端测试场景

### 场景 1:用户注册与登录

#### 1.1 新用户注册

1. 访问 `http://localhost:3000/register`
2. 填写:
   - 姓名:`测试用户A`
   - 邮箱:`test-user-a@example.com`
   - 密码:`Test123456`
3. 点击「注册」
4. **预期**: 自动跳转到 `/dashboard`,显示欢迎信息

#### 1.2 登录现有账号

1. 访问 `http://localhost:3000/login`
2. 填写:
   - 邮箱:`user@sep.local`
   - 密码:`Demo123456`
3. 点击「登录」
4. **预期**:
   - 跳转到 `/dashboard`
   - 显示「活跃订阅: 1」(已订阅小海)
   - 「我的碳基员工」区域显示「小海」卡片

---

### 场景 2:员工广场浏览与订阅

#### 2.1 浏览员工列表

1. 登录 `user@sep.local`
2. 左侧导航 → 「员工广场」(`/marketplace`)
3. **预期**:
   - 显示 3 个员工卡片:小海、阿析、小文
   - 每个卡片显示:名称、描述、行业、岗位、价格(¥0)
   - 「小海」卡片标记为「已订阅」

#### 2.2 订阅新员工

1. 点击「阿析」卡片的「订阅」按钮
2. **预期**:
   - 按钮变为「已订阅」
   - 右上角提示「订阅成功」
3. 返回「工作台」(`/dashboard`)
4. **预期**: 「活跃订阅: 2」,「我的碳基员工」显示小海 + 阿析

#### 2.3 取消订阅

1. 进入「我的订阅」(`/subscriptions`)
2. 找到「阿析」,点击「取消订阅」
3. 确认弹窗 → 「确定」
4. **预期**: 阿析从列表移除,活跃订阅数 -1

---

### 场景 3:对话中心(核心 AI 集成)

#### 3.1 创建会话

1. 登录 `user@sep.local`
2. 左侧导航 → 「对话中心」(`/chat`)
3. 点击右上角「+ 新建会话」
4. 选择员工:「小海」
5. 填写会话名称:「市场调研测试」
6. 点击「创建」
7. **预期**:
   - 左侧会话列表新增「市场调研测试」
   - 右侧显示输入框和「小海 · 海外获客助理」标题

#### 3.2 普通对话(不调用工具)

1. 在输入框输入:`你好,介绍一下你自己`
2. 点击「发送」或按 `Enter`
3. **预期**:
   - 左侧显示用户消息气泡(浅色背景)
   - 右侧流式显示助手回复(打字机效果)
   - 回复内容提到「小海」、「海外获客」等关键词
   - 消息下方显示 token 消耗(形如「输入: 12 · 输出: 85 · 总计: 97」)

⚠️ **如果失败**:
- 报错 `model_not_found` → 检查 `.env` 的 `SUB2API_DEFAULT_MODEL` 是否为 `deepseek-v4-flash`
- 报错 `401` / `Invalid API key` → 检查 `SUB2API_API_KEY` 是否有效
- 无响应 / 超时 → 检查后端日志,确认 sub2api 网络可达(`https://longdaoai.cn/v1`)

#### 3.3 工具调用(多步推理)

1. 输入:`搜索一下 2026 年全球跨境电商市场规模预测`
2. **预期流程**:
   - 助手识别需要「联网搜索」工具
   - 显示工具调用卡片:
     ```
     🔧 工具调用: 联网搜索
     参数: { query: "2026 global cross-border e-commerce market forecast" }
     ```
   - 显示工具结果卡片:
     ```
     ✅ 工具结果
     根据 XXX 机构预测,2026 年全球跨境电商市场规模约...
     ```
   - 助手基于工具结果总结回复

⚠️ **注意**: `demo-cap-search` 配置的是 `OPENCODE` 平台的 `web-search` 技能。如果 `OPENCODE_API_BASE_URL` 未配置(`.env` 中为空),工具调用会返回 `not_implemented` 错误,这是**预期行为**(OpenCode 服务未部署)。测试时可观察前端是否正确显示工具调用卡片即可。

#### 3.4 会话历史持久化

1. 刷新页面(`F5`)
2. **预期**:
   - 左侧会话列表保留
   - 点击「市场调研测试」,右侧消息历史全部恢复
   - 可继续对话(上下文保持)

---

### 场景 4:管理端 — 员工管理

#### 4.1 登录管理端

1. 退出当前账号(右上角 → 个人设置 → 退出登录)
2. 登录 `admin@sep.local` / `Demo123456`
3. **预期**: 自动跳转到 `/admin`(管理端主页)

#### 4.2 创建新员工

1. 左侧导航 → 「员工管理」
2. 点击右上角「+ 新建员工」
3. 填写表单:
   - **名称**: `测试员工X`
   - **描述**: `这是一个 E2E 测试创建的员工,用于验证管理端功能`
   - **行业**: `测试`
   - **岗位**: `测试工程师`
   - **系统提示词**: `你是一个测试助手,用于验证系统功能。回答简洁明确。`
   - **AI 模型**: 从下拉框选择 `DeepSeek V4 Flash`(不要手动输入,防止拼写错误)
   - **最大步数**: `10`
   - **状态**: `PUBLISHED`
4. 点击「保存」
5. **预期**:
   - 员工列表新增「测试员工X」
   - 状态显示「已发布」

#### 4.3 编辑员工

1. 找到「测试员工X」,点击编辑图标(铅笔)
2. 修改描述为:`已更新 - E2E 测试员工`
3. 修改模型为 `Gemini 3.5 Flash High`
4. 点击「保存」
5. **预期**: 列表中描述和模型已更新

#### 4.4 绑定能力

1. 找到「测试员工X」,点击「能力」列的「0 个」链接(或展开绑定面板)
2. 从下拉框选择「营销文案生成」
3. 点击「绑定」
4. **预期**: 能力列显示「1 个」,绑定列表出现「营销文案生成」

#### 4.5 删除员工

1. 找到「测试员工X」,点击删除图标(垃圾桶)
2. 确认弹窗 → 「确定」
3. **预期**: 员工从列表移除

---

### 场景 5:管理端 — Coze 能力导入(新增功能)

#### 5.1 导入 Coze Bot

**前置条件**:
- `.env` 中配置了有效的 `COZE_PAT`(形如 `pat_xxx`)
- 拥有一个已发布的 Coze Bot(记录 Bot ID,形如 `7xxxxxxxxxxxxxx`)

**步骤**:
1. 登录 `admin@sep.local`
2. 左侧导航 → 「能力管理」
3. 点击顶部 tab 「导入 Coze Bot」
4. 填写表单:
   - **Bot ID**: `7xxxxxxxxxxxxxx`(你的真实 Bot ID)
   - **能力名称**: `天气查询助手`
   - **能力描述**: `调用 Coze Bot 查询全球城市天气,支持中英文`
5. 点击「导入」
6. **预期**:
   - 弹出提示「✅ Coze Bot 导入成功」
   - 切换到「全部」tab,列表新增「天气查询助手」
   - 类型显示「AGENT」,状态显示「已通过」

⚠️ **如果失败**:
- 报错 `COZE_PAT not configured` → 检查 `.env` 的 `COZE_PAT` 是否填写
- 报错 `401` / `Coze API error` → PAT 无效或已过期,需在 Coze 控制台重新生成
- 报错 `botId not found` → Bot ID 错误,或该 Bot 未发布

#### 5.2 验证导入的 Coze 能力

1. 切回用户端(退出登录 → 登录 `user@sep.local`)
2. 创建新员工(或编辑现有员工「小海」),绑定「天气查询助手」
3. 创建新会话,选择该员工
4. 输入:`北京今天天气怎么样?`
5. **预期**:
   - 显示工具调用卡片「天气查询助手」
   - 工具结果返回北京天气(晴/雨、温度、湿度等)
   - 助手基于结果回复

---

### 场景 6:管理端 — 能力审核

#### 6.1 查看待审核能力

1. 登录 `admin@sep.local`
2. 左侧导航 → 「能力管理」
3. 默认显示「待审核」tab
4. **预期**: 如果有贡献者提交的能力(状态 `PENDING`),会显示在列表中

演示数据中所有能力状态均为 `APPROVED`,所以该 tab 默认为空。**测试时可通过 API 或数据库手动创建一个 `PENDING` 能力**:

```bash
# 通过 Prisma Studio 手动创建
pnpm db:studio
# 或通过 SQL
psql $DATABASE_URL -c "UPDATE capabilities SET status='PENDING', approved_at=NULL WHERE id='demo-cap-search';"
```

#### 6.2 审核通过

1. 待审核列表中找到目标能力
2. 点击「通过」按钮
3. **预期**:
   - 能力从待审核列表移除
   - 切换到「全部」tab,该能力状态显示「已通过」

#### 6.3 审核拒绝

1. 点击「拒绝」按钮
2. 弹窗输入拒绝理由:`描述不够详细,请补充使用场景`
3. 点击「确认」
4. **预期**:
   - 能力从待审核列表移除
   - 切换到「全部」tab,该能力状态显示「已拒绝」

---

## 三、关键验证点清单

### 3.1 前后端连通性

- [ ] Swagger UI 可访问(`http://localhost:3001/api/docs`)
- [ ] 前端页面加载无 CORS 错误(F12 控制台检查)
- [ ] 登录后 Cookie 正常设置(`httpOnly` 刷新 token)

### 3.2 数据库持久化

- [ ] 注册账号后,数据库 `users` 表新增记录
- [ ] 创建会话后,`conversation_sessions` 和 `messages` 表有数据
- [ ] 订阅员工后,`subscriptions` 表状态为 `ACTIVE`

### 3.3 AI 集成(最关键)

- [ ] 普通对话流式返回正常(逐字显示)
- [ ] token 消耗正确记录(`inputTokens` / `outputTokens` / `totalTokens` 都 > 0)
- [ ] 工具调用流程完整:
  1. 用户消息
  2. 工具调用卡片(名称 + 参数)
  3. 工具结果卡片(成功/失败状态 + 输出)
  4. 助手最终回复
- [ ] 多轮对话上下文保持(第二轮能引用第一轮内容)

### 3.4 安全性

- [ ] 管理端能力列表 **不显示** `agentConfig.apiKey`(F12 Network 检查响应,`apiKey` 字段应缺失)
- [ ] 普通用户访问 `/admin` 自动重定向到 `/dashboard`
- [ ] 未登录访问任何受保护页面,重定向到 `/login`

### 3.5 模型选择器(新增)

- [ ] 管理端创建/编辑员工时,「AI 模型」为下拉框,不是输入框
- [ ] 下拉框包含 7 个选项(DeepSeek V4 Flash/Pro, Gemini 3.5, GPT-4o, Claude Sonnet/Haiku)
- [ ] 默认值为 `DeepSeek V4 Flash`

### 3.6 Coze 导入(新增)

- [ ] 管理端「能力管理」有「导入 Coze Bot」tab
- [ ] 表单只需填 `botId` + `name` + `description`,无 PAT 输入框
- [ ] 导入成功后,能力类型为 `AGENT`,状态为 `APPROVED`
- [ ] 用户端对话时,Coze 工具调用正常(有工具卡片 + 结果卡片)

---

## 四、常见问题排查

### 4.1 后端启动失败

**症状**: `pnpm dev:backend` 报错 `ECONNREFUSED` / `connect ECONNREFUSED 127.0.0.1:5432`

**原因**: PostgreSQL 容器未启动或端口冲突

**解决**:
```bash
docker ps | grep sep-postgres  # 确认容器运行
docker logs sep-postgres       # 查看容器日志
lsof -i :5432                  # 检查端口占用
```

### 4.2 前端白屏 / CORS 错误

**症状**: 浏览器 F12 控制台报错 `Access-Control-Allow-Origin`

**原因**: 后端 CORS 配置不匹配

**解决**: 检查 `.env` 的 `CORS_ORIGIN` 是否包含 `http://localhost:3000`

### 4.3 AI 对话失败:`model_not_found`

**症状**: 发送消息后,助手回复 `模型 deepseek-chat 在上游不存在`

**原因**: 使用了不存在的模型 ID

**解决**:
```bash
# 1. 检查环境变量
grep SUB2API_DEFAULT_MODEL .env
# 应为: SUB2API_DEFAULT_MODEL="deepseek-v4-flash"

# 2. 如果员工的 modelId 字段是旧值,重置数据库
pnpm db:reset
```

### 4.4 AI 对话失败:`401 Unauthorized`

**症状**: 助手回复 `sub2api 认证失败` 或 `Invalid API key`

**原因**: `SUB2API_API_KEY` 无效

**解决**: 联系 sub2api 管理员获取有效 API Key,更新 `.env` 后重启后端。

### 4.5 Token 消耗全为 0

**症状**: 消息下方显示「输入: 0 · 输出: 0 · 总计: 0」

**原因**: `includeUsage: true` 未生效(已在本轮修复)

**验证**: 检查 `backend/src/modules/conversation/conversation-stream.service.ts:76`,确认有:
```typescript
const provider = createOpenAICompatible({ name: 'sub2api', baseURL, apiKey, includeUsage: true });
```

### 4.6 Coze 导入失败:`COZE_PAT not configured`

**症状**: 点击「导入」按钮,弹窗报错

**原因**: 环境变量未配置或 Coze adapter 未读取到

**解决**:
```bash
# 1. 确认 .env 有 COZE_PAT
grep COZE_PAT .env

# 2. 重启后端(环境变量改动需重启)
# Ctrl+C 终止 pnpm dev:backend,再次运行

# 3. 如果仍失败,检查 agentConfig.apiKey 是否为空(允许为空,会回退到全局 PAT)
```

### 4.7 工具调用卡片不显示

**症状**: 发送需要工具的消息(如「搜索XXX」),但没有工具调用卡片,直接返回文本

**原因**: 员工未绑定能力,或能力配置错误

**解决**:
1. 管理端检查员工的「能力」列,确认绑定了对应能力
2. 检查能力的 `agentConfig`/`skillConfig` 是否完整
3. 查看后端日志,搜索 `Tool execution` 相关错误

---

## 五、自动化测试(可选)

当前项目 **暂无 E2E 自动化测试框架**(`backend/test/` 目录不存在)。如需补充,推荐:

### 5.1 后端 API 测试

使用 Jest + Supertest:

```bash
# backend/test/e2e/auth.e2e-spec.ts
describe('Auth E2E', () => {
  it('POST /auth/register - should create user', async () => {
    const res = await request(app.getHttpServer())
      .post('/auth/register')
      .send({ name: 'Test', email: 'test@e2e.com', password: 'Test123456' })
      .expect(201);
    
    expect(res.body).toHaveProperty('accessToken');
  });
});
```

运行:
```bash
pnpm test:e2e  # backend/package.json 已配置
```

### 5.2 前端 E2E 测试

使用 Playwright 或 Cypress:

```bash
# 安装 Playwright
pnpm add -D @playwright/test

# web/tests/e2e/chat.spec.ts
test('user can send message and receive reply', async ({ page }) => {
  await page.goto('http://localhost:3000/login');
  await page.fill('[name="email"]', 'user@sep.local');
  await page.fill('[name="password"]', 'Demo123456');
  await page.click('button[type="submit"]');
  
  await page.click('text=对话中心');
  await page.fill('[placeholder="输入消息..."]', '你好');
  await page.click('button:has-text("发送")');
  
  await page.waitForSelector('.message-bubble:has-text("你好,我是小海")');
});
```

运行:
```bash
pnpm exec playwright test
```

---

## 六、验收标准

完整通过以下场景,视为 AI 集成 E2E 测试通过:

1. ✅ 用户能注册、登录、浏览员工、订阅员工
2. ✅ 用户能创建会话、发送消息、收到流式 AI 回复
3. ✅ Token 消耗正确记录(不为 0)
4. ✅ 工具调用流程完整(调用卡片 + 结果卡片 + 最终回复)
5. ✅ 管理员能创建员工、绑定能力、导入 Coze Bot
6. ✅ 管理员创建员工时,模型选择器为下拉框(7 个选项)
7. ✅ 管理端能力列表不泄露 `apiKey`
8. ✅ 刷新页面后会话历史保持
9. ✅ 普通用户无法访问 `/admin`

---

## 七、附录

### 7.1 快速重置环境

```bash
# 完整重置(数据库 + 演示数据)
docker-compose down && docker-compose up -d && sleep 5 && pnpm db:reset
```

### 7.2 测试数据速查

| 实体 | 数量 | 固定 ID | 说明 |
|------|------|---------|------|
| 用户 | 2 | `demo-user-admin`, `demo-user-normal` | admin@sep.local, user@sep.local |
| 员工 | 3 | `demo-emp-hai`, `demo-emp-xi`, `demo-emp-wen` | 小海/阿析/小文 |
| 能力 | 4 | `demo-cap-search`, `demo-cap-copywriting`, `demo-cap-rpa-scrape`, `demo-cap-dashboard` | 4 种类型 |
| 订阅 | 1 | - | user@sep.local 订阅小海 |

### 7.3 Swagger 快速测试

访问 `http://localhost:3001/api/docs`,点击右上角「Authorize」,输入 token(登录后从响应中获取),即可直接测试所有 API。

**获取 token**:
```bash
curl -X POST http://localhost:3001/auth/login \
  -H "Content-Type: application/json" \
  -d '{"email":"user@sep.local","password":"Demo123456"}' \
  | jq -r '.accessToken'
```

---

**文档维护**: 随代码变更同步更新,确保测试步骤与实际功能一致。
