# 计费系统端到端测试指南

> 测试日期：2026-07-25  
> 测试范围：对话计费 + Token 统计 + 用量查询

---

## 前置条件

### 1. 环境准备

确保以下服务正常运行：

```bash
# 1. 检查 PostgreSQL
docker ps | grep postgres

# 2. 检查后端 (端口 3001)
curl http://localhost:3001/health

# 3. 检查前端 (端口 3000)
curl http://localhost:3000
```

### 2. 数据准备

确保数据库有以下测试数据：

- ✅ 测试用户已登录 (admin@sep.local)
- ✅ 至少有一个已发布的数字员工
- ✅ 用户已订阅该员工
- ✅ 用户账户有充足余额（例如 ¥100）

### 3. 配置检查

```bash
# 后端 .env 文件必须包含：
SUB2API_BASE_URL=https://api.sub2api.com/v1
SUB2API_API_KEY=sk-xxxxx
SUB2API_DEFAULT_MODEL=gemini-3.5-flash-high
```

---

## 测试场景 1: 对话生成与计费

### 步骤 1: 发起对话

1. 打开浏览器 http://localhost:3000
2. 登录账号 `admin@sep.local` / `Admin@123`
3. 进入"对话中心"
4. 点击"新建会话"
5. 选择已订阅的员工（例如"小文"）
6. 在输入框输入: `你好,请介绍一下你自己`
7. 点击发送或按回车

### 预期结果 ✅

- [ ] 消息立即显示在聊天窗口（用户消息在右侧，蓝色气泡）
- [ ] AI 回复流式显示（员工消息在左侧，白色气泡，带头像）
- [ ] 回复完成后不出现重复内容
- [ ] 浏览器开发者工具 Network 标签显示 SSE 连接成功
- [ ] 后端日志显示 `[Billing Check]` 和 `[Billing] Recording usage`

### 步骤 2: 查看后端日志

打开终端，运行：

```bash
tail -100 /Users/yao/.claude/jobs/7a1cc777/tmp/backend-new.log | grep -E "Billing|usage"
```

### 预期日志输出 ✅

```
[Billing Check] usage={"promptTokens":15,"completionTokens":120,...}, input=15, output=120
[Billing] Recording usage for session xxx: input=15, output=120
Recorded usage for user xxx: 15/120 tokens, cost ¥0.0012
```

### 如果看到警告 ⚠️

```
[Billing] Skipped recording - missing usage data for session xxx
```

**说明**: AI SDK 的 `usage` 对象为空或字段名不匹配。需要检查：
- sub2api 配置是否正确
- 模型是否支持返回 usage 数据
- AI SDK 版本兼容性

---

## 测试场景 2: 用量统计查询

### 步骤 1: 打开用量统计页面

1. 在左侧边栏点击"用量统计"
2. 或直接访问 http://localhost:3000/usage

### 预期结果 ✅

页面显示以下卡片：

- [ ] **账户余额**: 显示当前余额（例如 ¥99.9988）
- [ ] **累计消费**: 显示总消费金额（例如 ¥0.0012）
- [ ] **输入 Token**: 显示总输入 token 数（例如 15）
- [ ] **输出 Token**: 显示总输出 token 数（例如 120）

### 步骤 2: 查看交易记录

滚动到页面底部的"交易记录"表格。

### 预期结果 ✅

- [ ] 表格显示刚才的对话消费记录
- [ ] 列包括: 时间、类型、金额、描述、会话 ID
- [ ] 类型显示"消费"（不是"用量"）
- [ ] 金额为负数（例如 -¥0.0012）
- [ ] 描述显示模型名称（例如"gemini-3.5-flash-high 对话消费"）

### 如果显示全部为 0 ⚠️

打开浏览器开发者工具 (F12)，检查：

1. **Console 标签**: 有无红色错误？
2. **Network 标签**: 找到 `compute-usage` 请求
   - Status Code 是 200 还是 304/404/500?
   - Response 返回了什么数据？

---

## 测试场景 3: 多轮对话计费累加

### 步骤 1: 继续对话

在同一会话中再发送 2-3 条消息，例如：

1. `你会写代码吗?`
2. `用 Python 写一个 Hello World`

### 步骤 2: 刷新用量统计页面

按 F5 刷新 http://localhost:3000/usage

### 预期结果 ✅

- [ ] 累计消费金额增加
- [ ] 输入/输出 Token 数增加
- [ ] 交易记录表格新增 2-3 条记录
- [ ] 每条记录对应一次 AI 回复
- [ ] 账户余额相应减少

---

## 测试场景 4: 数据库验证

### 步骤 1: 查询 Message 表

```bash
docker exec -it postgres-dev psql -U sepuser -d sepdb -c "
SELECT id, role, content, \"inputTokens\", \"outputTokens\", \"createdAt\"
FROM messages
WHERE role = 'ASSISTANT'
ORDER BY \"createdAt\" DESC
LIMIT 5;
"
```

### 预期结果 ✅

- [ ] 每条 ASSISTANT 消息都有 `inputTokens` 和 `outputTokens` 字段
- [ ] Token 数值 > 0
- [ ] `createdAt` 时间戳正确

### 步骤 2: 查询 ComputeTransaction 表

```bash
docker exec -it postgres-dev psql -U sepuser -d sepdb -c "
SELECT id, type, amount, \"sessionId\", description, metadata, \"createdAt\"
FROM compute_transactions
WHERE type = 'CONSUME'
ORDER BY \"createdAt\" DESC
LIMIT 5;
"
```

### 预期结果 ✅

- [ ] 每次对话生成一条 `type='CONSUME'` 记录
- [ ] `amount` 为负数（表示消费）
- [ ] `metadata` 包含 `inputTokens`, `outputTokens`, `costUSD`, `costCNY`
- [ ] `sessionId` 对应会话 ID

### 如果表为空 ⚠️

说明 `recordUsage()` 没被调用，需要检查：

1. 后端日志是否显示 `[Billing] Skipped recording`?
2. AI 回复是否真的完成了（有 `done` 事件）?
3. `usage` 对象是否为空？

---

## 测试场景 5: 价格计算验证

### 验证公式

根据 `backend/src/shared/index.ts` 的价格表：

```typescript
// 以 gemini-3.5-flash-high 为例
inputPrice: 0.05,   // USD per 1M tokens
outputPrice: 0.15,  // USD per 1M tokens
usdToCnyRate: 7.2
```

**计算公式**:
```
costUSD = (inputTokens × 0.05 + outputTokens × 0.15) / 1,000,000
costCNY = costUSD × 7.2
```

### 手动验证

假设一次对话使用了:
- 输入: 15 tokens
- 输出: 120 tokens

**预期计算**:
```
costUSD = (15 × 0.05 + 120 × 0.15) / 1,000,000
        = (0.75 + 18) / 1,000,000
        = 0.00001875 USD

costCNY = 0.00001875 × 7.2
        = 0.000135 CNY
        ≈ ¥0.0001
```

### 验证步骤 ✅

1. 在数据库查询 `metadata` 字段:
   ```sql
   SELECT metadata FROM compute_transactions WHERE type='CONSUME' LIMIT 1;
   ```

2. 检查 `costUSD` 和 `costCNY` 是否与手动计算一致

3. 检查 `amount` 字段是否等于 `-costCNY`

---

## 常见问题排查

### 问题 1: 用量统计显示全部为 0

**可能原因**:
1. 后端计费逻辑没执行
2. `usage` 对象为空
3. 数据库没有 CONSUME 记录

**排查步骤**:
```bash
# 1. 查看后端日志
tail -100 /Users/yao/.claude/jobs/7a1cc777/tmp/backend-new.log | grep Billing

# 2. 检查数据库
docker exec -it postgres-dev psql -U sepuser -d sepdb -c "SELECT COUNT(*) FROM compute_transactions WHERE type='CONSUME';"

# 3. 检查 API 响应
curl -H "Authorization: Bearer <your-token>" http://localhost:3001/users/me/compute-usage
```

---

### 问题 2: 回复内容重复两遍

**原因**: React StrictMode 导致流式连接被打开两次

**解决方案**:
- 刷新页面后重复消失 = 正常（已在代码中修复清理逻辑）
- 如果刷新后仍重复 = 需要检查 `chat-window.tsx` 的 `showLiveAssistant` 逻辑

---

### 问题 3: 用户消息显示成员工头像

**原因**: 消息 `role` 字段不正确

**排查步骤**:
```bash
# 查看数据库中用户消息的 role
docker exec -it postgres-dev psql -U sepuser -d sepdb -c "SELECT id, role, content FROM messages WHERE role='USER' LIMIT 5;"
```

**预期**: `role` 应为 `'USER'` (大写)

**如果是其他值**: 检查 `conversation-stream.service.ts` 第 63 行的保存逻辑

---

### 问题 4: 后端日志显示 "Skipped recording"

**原因**: AI SDK 的 `usage` 对象为空或字段名不匹配

**排查步骤**:
1. 查看日志中的 `[Billing Check]` 输出，确认 `usage` 对象内容
2. 检查 sub2api 配置是否正确
3. 尝试更换模型（有些模型不返回 usage）

**临时解决方案**:
在 `conversation-stream.service.ts` 中添加 fallback 估算：
```typescript
const inputTokens = usage?.promptTokens ?? usage?.inputTokens ?? Math.ceil(content.length / 4);
const outputTokens = usage?.completionTokens ?? usage?.outputTokens ?? Math.ceil(accumulatedText.length / 4);
```

---

## 测试检查清单

### 基础功能 ✅
- [ ] 用户可以发送消息
- [ ] AI 流式回复正常显示
- [ ] 回复内容不重复
- [ ] 用户消息样式正确（右侧蓝色气泡）
- [ ] AI 消息样式正确（左侧白色气泡 + 头像）

### 计费功能 ✅
- [ ] Message 表记录了 inputTokens 和 outputTokens
- [ ] ComputeTransaction 表有 CONSUME 记录
- [ ] metadata 包含完整的计费信息
- [ ] 成本计算公式正确

### 用量统计 ✅
- [ ] 用量统计页面显示正确的数据
- [ ] 账户余额实时更新
- [ ] 累计消费正确累加
- [ ] Token 统计准确
- [ ] 交易记录完整显示

### 后端日志 ✅
- [ ] 后端日志显示 `[Billing Check]`
- [ ] 后端日志显示 `[Billing] Recording usage`
- [ ] 后端日志显示 `Recorded usage for user`
- [ ] 无错误或警告

---

## 下一步

测试通过后，可以继续：

1. **优化价格表管理**: 从硬编码迁移到数据库
2. **模型映射优化**: 参考 sub2api 的动态模型获取
3. **错误处理增强**: 统一异常处理 + 用户友好提示
4. **日志结构化**: 添加结构化日志 (Winston + Elasticsearch)
5. **性能监控**: 添加 APM (如 Sentry/DataDog)

---

## 相关文档

- [开发状态](../status/development-status.md)
- [API 文档](http://localhost:3001/api/docs)
- [数据库 Schema](../architecture/硅基人才平台-需求与架构规格书-v2.md)
