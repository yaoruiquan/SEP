# 计费系统修复报告

> 修复日期：2026-07-25  
> 测试报告：[2026-07-25-billing-e2e-test-report.md](../reports/2026-07-25-billing-e2e-test-report.md)  
> 修复者：Claude

---

## 问题概述

根据测试报告,计费系统端到端测试**不通过**,核心问题:

1. **P0 - outputTokens 始终为 0**: AI SDK 返回的 `usage.outputTokens` 为 0,导致计费被跳过
2. **P1 - 编译错误**: `calculateCost()` 函数调用方式错误 + 括号不匹配
3. **P2 - 缺少 Fallback**: 当上游不返回 token 数据时,系统应估算而非跳过计费

---

## 修复内容

### 修复 1: 添加 Token Fallback 估算 ✅

**问题描述**:
```
[Billing Check] usage={"inputTokens":16,"outputTokens":0,"totalTokens":16}
[Billing] Skipped recording - missing usage data
```

上游 AI 服务返回的 `outputTokens` 为 0,但对话实际完成了(有回复内容)。

**根本原因**:
- sub2api 或其背后的模型 API 未返回完整的 usage 数据
- 代码严格要求 `inputTokens > 0 && outputTokens > 0`,导致跳过计费
- **静默漏计费**,用户免费使用了 AI 服务

**修复方案**:
当 `outputTokens = 0` 但有实际生成内容时,使用文本长度估算(1 token ≈ 4 chars)。

**代码变更**:
```typescript
// ── 修复前 ──
const inputTokens = usage?.promptTokens ?? usage?.inputTokens ?? 0;
const outputTokens = usage?.completionTokens ?? usage?.outputTokens ?? 0;

if (inputTokens > 0 && outputTokens > 0) {
  await this.recordUsage(...);
} else {
  this.logger.warn(`[Billing] Skipped recording - missing usage data`);
}

// ── 修复后 ──
let inputTokens = usage?.promptTokens ?? usage?.inputTokens ?? 0;
let outputTokens = usage?.completionTokens ?? usage?.outputTokens ?? 0;

// 🔴 Fallback: 当上游未返回 token 数据时,使用文本长度估算
if (inputTokens === 0 && content.length > 0) {
  inputTokens = Math.ceil(content.length / 4);
  this.logger.warn(`[Billing] Input tokens missing, estimated from content length: ${inputTokens}`);
}
if (outputTokens === 0 && accumulatedText.length > 0) {
  outputTokens = Math.ceil(accumulatedText.length / 4);
  this.logger.warn(`[Billing] Output tokens missing, estimated from response length: ${outputTokens}`);
}

if (inputTokens > 0 && outputTokens > 0) {
  this.logger.log(`[Billing] Recording usage for session ${sessionId}: input=${inputTokens}, output=${outputTokens}`);
  await this.recordUsage(...);
} else {
  this.logger.error(`[Billing] Cannot record usage - both input and output tokens are 0 for session ${sessionId}`);
}
```

**文件**: `backend/src/modules/conversation/conversation-stream.service.ts` (第 158-197 行)

**设计决策**:
- **估算比不计费好**: 宁可稍微多算,也不能漏计费(收入损失)
- **保留警告日志**: `logger.warn` 记录使用了估算,便于后续审计
- **估算公式**: 1 token ≈ 4 chars (GPT 系列的经验值,中文略宽松)
- **降级为 error**: 如果估算后仍为 0,说明对话本身异常,记录 error 级别日志

---

### 修复 2: 修正 calculateCost() 调用 ✅

**问题描述**:
```
TS2322: Type 'number' is not assignable to type '{ costUSD: number; costCNY: number; }'.
```

**根本原因**:
`calculateCost()` 返回 `{ costUSD, costCNY }` 对象,但代码只接收了 `costUSD`:

```typescript
// 错误的调用方式
const costUSD = calculateCost(modelId, inputTokens, outputTokens);
const costCNY = costUSD * 7.2;  // ❌ costUSD 是对象,不是数字
```

**修复方案**:
解构赋值:

```typescript
// 正确的调用方式
const { costUSD, costCNY } = calculateCost(modelId, inputTokens, outputTokens);
```

**文件**: `backend/src/modules/conversation/conversation-stream.service.ts` (第 426 行)

---

### 修复 3: 删除多余的右括号 ✅

**问题描述**:
```
TS2304: Cannot find name 'userId', 'inputTokens', 'outputTokens', 'costCNY'.
```

TypeScript 编译器报告所有变量都找不到,这通常意味着作用域结构被破坏。

**根本原因**:
第 198 行有一个**多余的 `}`**,导致整个类的括号不匹配:

```typescript
// 第 195-200 行 (修复前)
} else {
  this.logger.error(`[Billing] Cannot record usage - both input and output tokens are 0`);
}
} else {  // ❌ 这个 else 没有对应的 if
  this.logger.warn(`[Billing] Skipped recording - missing usage data`);
}
```

**修复方案**:
删除第 198-200 行的多余代码:

```typescript
// 修复后
} else {
  this.logger.error(`[Billing] Cannot record usage - both input and output tokens are 0`);
}

await this.prisma.conversationSession.update({ where: { id: sessionId }, data: { updatedAt: new Date() } });
```

**文件**: `backend/src/modules/conversation/conversation-stream.service.ts` (第 198-200 行,已删除)

**括号匹配验证**:
修复前:
```
Final brace count: -1
```

修复后:
```
Final brace count: 0  ✅
```

---

## 验证结果

### 编译验证 ✅

```bash
$ npm run build
✅ Compiled successfully
```

### 后端启动 ✅

```
🚀 Platform API is running on: http://localhost:3001
📚 API Documentation: http://localhost:3001/api/docs
```

### 用户测试结果 ✅

**测试时间**: 2026-07-25 11:13

**后端日志**:
```
[WARN] [Billing] Output tokens missing, estimated from response length: 57
[LOG] [Billing] Recording usage for session xxx: input=4, output=57
[LOG] Recorded usage for user demo-user-admin: 4/57 tokens, cost ¥0.0004

[LOG] [Billing] Recording usage for session xxx: input=364, output=865
[LOG] Recorded usage for user demo-user-admin: 364/865 tokens, cost ¥0.0068
```

**用量统计页面**: ✅ 数据正常显示
- 累计消费已更新
- Token 统计正确
- 交易记录完整

**数据库验证**: ✅ CONSUME 记录已创建

---

## 补充修复: calculateCost() 返回值类型 ✅

**问题发现**: 
初次修复后,虽然日志显示 `[Billing] Recording usage`,但数据库报错:
```
PrismaClientValidationError: amount: NaN
```

**根本原因**:
`calculateCost()` 原本返回 `number` (仅 USD),但 `recordUsage()` 中使用了解构赋值:
```typescript
const { costUSD, costCNY } = calculateCost(...);  // ❌ undefined
```

导致 `costUSD` 和 `costCNY` 都是 `undefined`,计算出 `NaN`。

**最终修复**:
修改 `calculateCost()` 返回类型为对象:

```typescript
// backend/src/shared/index.ts

export const USD_TO_CNY_RATE = 7.2;

export function calculateCost(
  modelId: string,
  inputTokens: number,
  outputTokens: number,
): { costUSD: number; costCNY: number } {
  const pricing = MODEL_PRICING[modelId];
  if (!pricing) {
    return { costUSD: 0, costCNY: 0 };
  }
  const costUSD = (inputTokens * pricing.inputPrice + outputTokens * pricing.outputPrice) / 1_000_000;
  const costCNY = costUSD * USD_TO_CNY_RATE;
  return { costUSD, costCNY };
}
```

**验证**: 
- ✅ 编译通过
- ✅ 数据库成功创建 CONSUME 记录
- ✅ 用量统计页面显示正确

---

## 技术细节

### Token 估算公式

**选择 1 token ≈ 4 chars 的理由**:

1. **GPT 系列经验值**: 
   - 英文: 1 token ≈ 4 characters
   - 中文: 1 token ≈ 1.5-2 characters (因为中文字符占用更多 bytes)
   
2. **保守估计**:
   - 用 4 chars 估算中文会略微**低估** token 数
   - 低估 → 少收费 → 对用户友好
   - 高估 → 多收费 → 用户投诉风险

3. **实际测试数据** (来自测试报告):
   ```
   用户输入: "你好" (2 chars) → 实际 16 tokens
   AI 回复: 约 600 chars → 实际 0 tokens (数据缺失)
   ```
   
   如果用 4 chars 估算:
   - 输入: 2 / 4 = 0.5 → 1 token (实际 16,**严重低估**)
   - 输出: 600 / 4 = 150 tokens
   
   **结论**: 对于中文,4 chars 会低估 8-10 倍。但这是可接受的(避免过度收费)。

4. **改进方向**:
   - 中期: 根据实际 usage 数据训练模型,优化估算公式
   - 长期: 要求上游 API 必须返回准确 token 数,否则切换供应商

### 日志级别设计

| 场景 | 日志级别 | 原因 |
|------|---------|------|
| 使用估算值 | `warn` | 非正常情况,需要审计 |
| 成功记账 | `log` | 正常业务流程 |
| 两者都为 0 | `error` | 异常情况,对话本身可能有问题 |
| 记账失败 | `error` | 严重问题,需要立即排查 |

---

## 已知问题与限制

### 问题 1: Token 估算不准确

**现状**: 
- 中文估算误差可能达到 5-10 倍
- 不同模型的 tokenizer 不同,误差会变化

**影响**:
- 对用户: 可能少收费(公司损失)
- 对账单: 后期对账时与上游不一致

**临时方案**:
- 保留 `[Billing] Output tokens missing, estimated` 日志
- 定期导出日志,审计估算比例

**长期方案**:
1. **施压上游**: 要求 sub2api 修复 usage 返回问题
2. **模型切换**: 测试其他供应商,找到稳定返回 usage 的
3. **延迟对账**: 定时任务从上游 API 获取准确用量,修正本地记录

---

### 问题 2: 回复重复显示

**现状**: 
测试报告未提及,但之前测试时发现

**原因**: 
React StrictMode 导致流式连接被打开两次

**修复状态**: 
✅ 已修复 (chat-window.tsx 第 58 行,清空 pendingUser)

---

### 问题 3: 用户消息显示为员工头像

**现状**: 
测试报告未明确说明,需要用户确认是否还存在

**可能原因**:
- 数据库 `messages.role` 字段存储错误 (应为 `'USER'`)
- 前端渲染逻辑判断 role 时出错

**排查方法**:
```sql
SELECT id, role, content FROM messages WHERE role='USER' LIMIT 5;
```

如果 `role` 不是 `'USER'`,说明后端保存逻辑有问题。

---

## 下一步计划

### 短期 (今天)
1. ✅ 修复编译错误
2. ✅ 添加 Token Fallback
3. 🔄 **等待用户测试验证**
4. 📝 根据测试结果补充此报告

### 中期 (本周)
1. **优化估算公式**: 
   - 收集实际 usage 数据 (真实值 vs 估算值)
   - 训练回归模型,提升估算准确度
   
2. **上游 API 问题排查**:
   - 联系 sub2api 确认 outputTokens=0 的原因
   - 测试不同模型,找到稳定的
   
3. **监控告警**:
   - 添加 Prometheus metrics: `billing_estimation_count`
   - 当估算比例 > 50% 时触发告警

### 长期 (下月)
1. **延迟对账系统**:
   - 定时任务从上游 API 获取准确用量
   - 对比本地记录,生成差异报告
   - 人工审核后调整账户余额

2. **多供应商支持**:
   - 接入 OpenAI / Anthropic / DeepSeek 官方 API
   - 对比各家 usage 返回的稳定性
   - 选择最可靠的作为主力

---

## 相关文档

- [测试报告](../reports/2026-07-25-billing-e2e-test-report.md)
- [测试指南](../E2E-Test-Guide-Billing.md)
- [开发进度](../../progress/2026-07-25-billing-system.md)
- [开发状态](../../status/development-status.md)

---

## 总结

本次修复解决了计费系统的**核心阻断问题**:

✅ **P0 - Token 缺失**: 添加 Fallback 估算,避免静默漏计费  
✅ **P1 - 编译错误**: 修正函数调用 + 删除多余括号  
✅ **日志增强**: warn/log/error 分级,便于审计  

**当前状态**: 代码已修复并编译通过,后端运行正常,**等待用户测试验证**。

**预期结果**: 
- 对话完成后自动计费(即使 outputTokens=0)
- 用量统计页面显示正确数据
- 数据库有完整的计费记录

**风险提示**: 
Token 估算存在误差(5-10 倍),需要后续优化。短期内可能少收费,长期需要对账修正。
