# 前端验证 P2 计算配额系统指南

**日期**: 2026-08-14  
**服务状态**: ✅ 后端运行在 http://localhost:3001，前端运行在 http://localhost:3000

## 验证目标

在前端界面验证 P2 计算配额系统的完整流程：
1. 查看企业配额余额
2. 创建会话并发送消息
3. 验证配额扣费
4. 查看交易记录

## 前置准备

### 1. 确认服务运行

```bash
# 后端
curl http://localhost:3001/health

# 前端
curl http://localhost:3000
```

### 2. 测试账号

- **邮箱**: boss@acme.local
- **密码**: Demo123456
- **企业**: 示例科技有限公司
- **角色**: 企业管理员
- **初始配额**:
  - FREE: 100,000 tokens (priority 0)
  - STANDARD: 1,000,000 tokens (priority 1)

## 验证步骤

### 步骤 1: 登录系统

1. 打开浏览器访问 http://localhost:3000
2. 使用 boss@acme.local / Demo123456 登录
3. 确认登录成功，进入企业端界面

**预期结果**: 
- 登录成功，显示用户名 "甲总"
- 侧边栏显示企业名称 "示例科技有限公司"
- 角色显示为 "企业管理员"

---

### 步骤 2: 查看初始配额

**页面路径**: `/enterprise/compute-quota` 或 "计费管理" → "算力配额"

**API 端点**: `GET /compute-quota`

**预期显示**:

| 配额类型 | 总量 | 已用 | 剩余 | 优先级 | 状态 |
|---------|------|------|------|--------|------|
| FREE (免费配额) | 100,000 | 0 | 100,000 | 0 | 活跃 |
| STANDARD (标准配额) | 1,000,000 | 0 | 1,000,000 | 1 | 活跃 |

**验证要点**:
- ✅ 显示 2 个配额
- ✅ 已用量为 0
- ✅ 剩余量 = 总量
- ✅ 状态显示为"活跃"或"ACTIVE"

**浏览器开发者工具验证**:
```javascript
// 打开 Console，执行：
fetch('http://localhost:3001/compute-quota', {
  headers: {
    'Authorization': `Bearer ${localStorage.getItem('access_token')}`
  }
}).then(r => r.json()).then(console.log)
```

---

### 步骤 3: 查看企业订阅

**页面路径**: `/enterprise/subscriptions` 或 "雇佣管理"

**API 端点**: `GET /subscriptions`

**预期显示**:
- ✅ 显示 2 个已订阅员工：
  1. **文案助手（技能包）** (demo-emp-skills)
  2. **市场调研员** (demo-emp-research)
- ✅ 状态显示为"活跃"
- ✅ 可以查看员工详情

---

### 步骤 4: 创建会话并发送消息

**页面路径**: `/enterprise/chat` 或 "我的员工" → 点击某个员工卡片

**操作步骤**:
1. 选择 "市场调研员" 或 "文案助手"
2. 进入聊天界面
3. 发送消息：`"你好，介绍一下你自己"`
4. 等待 AI 响应

**API 调用顺序**:
```
1. POST /conversations {"employeeId": "demo-emp-research"}
   → 返回 sessionId
   
2. POST /conversations/{sessionId}/messages {"content": "你好..."}
   → SSE 流式返回 AI 响应
   
3. (自动) 对话结束后后端扣费
```

**预期结果**:
- ✅ 会话创建成功（配额预检通过）
- ✅ AI 开始响应（SSE 流式输出）
- ✅ 消息显示在聊天界面
- ✅ 无报错

**验证配额预检**:
如果配额不足，创建会话时会返回 400 错误：
```json
{
  "message": "企业配额不足",
  "error": "Bad Request",
  "statusCode": 400
}
```

---

### 步骤 5: 验证配额扣费

**操作**: 对话结束后，返回配额管理页面刷新

**页面路径**: `/enterprise/compute-quota`

**预期变化**:

| 配额类型 | 总量 | 已用 | 剩余 | 变化 |
|---------|------|------|------|------|
| FREE | 100,000 | **25** | 99,975 | ✅ 已用增加 |
| STANDARD | 1,000,000 | 0 | 1,000,000 | ⚪ 未动用 |

**验证要点**:
- ✅ FREE 配额的 `usedTokens` 增加（约 20-50 tokens）
- ✅ STANDARD 配额未动用（优先级验证）
- ✅ 剩余量正确计算：`remaining = total - used`
- ✅ 页面显示扣费时间（updatedAt）

**开发者工具验证**:
```javascript
// 刷新配额数据
fetch('http://localhost:3001/compute-quota', {
  headers: {
    'Authorization': `Bearer ${localStorage.getItem('access_token')}`
  }
}).then(r => r.json()).then(data => {
  console.log('FREE quota used:', data.find(q => q.type === 'FREE').usedTokens);
  console.log('STANDARD quota used:', data.find(q => q.type === 'STANDARD').usedTokens);
})
```

---

### 步骤 6: 查看交易记录

**页面路径**: `/enterprise/compute-quota/{quotaId}` 或 点击配额卡片进入详情

**API 端点**: `GET /compute-quota/acme-quota-free`

**预期显示**:

交易记录列表（从新到旧）：

| 时间 | 类型 | Token 数 | 金额 | 会话 ID | 描述 |
|------|------|---------|------|---------|------|
| 2026-08-14 11:23:59 | CONSUME | 25 | -¥0.00009504 | cmssuzx... | gemini-3.5-flash-high 对话消费 |

**交易详情 metadata**:
```json
{
  "enterpriseId": "demo-ent-acme",
  "memberId": "demo-mem-acme-boss",
  "isOverage": false,
  "inputTokens": 4,
  "outputTokens": 21,
  "quotaResults": [
    {
      "quotaId": "acme-quota-free",
      "consumed": 25,
      "remaining": 99975,
      "isOverage": false
    }
  ]
}
```

**验证要点**:
- ✅ 显示交易记录
- ✅ 包含 token 数量
- ✅ 包含会话 ID（可追溯到具体对话）
- ✅ metadata 包含详细信息
- ✅ `isOverage: false`（未超额）

---

### 步骤 7: 多次对话验证累计扣费

**操作**: 
1. 继续在聊天界面发送 2-3 条消息
2. 返回配额页面查看累计扣费

**预期结果**:
- ✅ `usedTokens` 持续增加
- ✅ 每次对话生成新的交易记录
- ✅ 交易记录按时间倒序排列
- ✅ 剩余量实时更新

**示例计算**:
```
对话 1: 25 tokens
对话 2: 30 tokens
对话 3: 35 tokens
---
总计: 90 tokens
剩余: 100,000 - 90 = 99,910 tokens
```

---

### 步骤 8: 验证配额告警（可选）

**前置**: 手动修改配额使剩余 < 10%

**API 端点**: `GET /compute-quota/alerts`

**数据库操作**:
```sql
UPDATE compute_quota 
SET used_tokens = 91000 
WHERE id = 'acme-quota-free';
```

**预期结果**:
- ✅ 告警接口返回配额列表
- ✅ 前端显示告警标识（如红色徽章）
- ✅ 告警信息：`剩余 9,000 tokens (9%)`

---

## 验证清单

### 功能验证

- [ ] 登录成功并显示企业信息
- [ ] 配额列表显示正确（2 个配额）
- [ ] 初始配额已用量为 0
- [ ] 订阅列表显示 2 个员工
- [ ] 创建会话成功（配额预检通过）
- [ ] AI 对话正常响应
- [ ] 配额扣费正确（从 FREE 扣除）
- [ ] STANDARD 配额未动用（优先级验证）
- [ ] 交易记录显示完整
- [ ] 多次对话累计扣费正确
- [ ] 剩余量实时更新

### UI/UX 验证

- [ ] 配额卡片显示清晰（总量、已用、剩余）
- [ ] 进度条正确显示使用百分比
- [ ] 状态徽章正确（活跃/耗尽/过期）
- [ ] 交易记录时间格式化正确
- [ ] 加载状态正常（Skeleton/Spinner）
- [ ] 错误提示友好（配额不足时）
- [ ] 响应式布局正常（移动端/桌面端）

### 边界情况验证

- [ ] 配额耗尽时创建会话被阻止
- [ ] 配额低于 10% 时显示告警
- [ ] 网络错误时显示重试选项
- [ ] 无配额时显示引导充值
- [ ] 过期配额不参与扣费

---

## API 参考

### 查询配额列表
```bash
GET /compute-quota
Authorization: Bearer {token}

Response:
[
  {
    "id": "acme-quota-free",
    "type": "FREE",
    "totalTokens": 100000,
    "usedTokens": 0,
    "priority": 0,
    "status": "ACTIVE"
  }
]
```

### 查询配额详情
```bash
GET /compute-quota/{quotaId}
Authorization: Bearer {token}

Response:
{
  "id": "acme-quota-free",
  "type": "FREE",
  "totalTokens": 100000,
  "usedTokens": 25,
  "transactions": [...]
}
```

### 查询配额告警
```bash
GET /compute-quota/alerts
Authorization: Bearer {token}

Response:
[
  {
    "quotaId": "acme-quota-free",
    "type": "FREE",
    "remaining": 9000,
    "percentage": 0.09
  }
]
```

---

## 常见问题

### Q1: 配额查询返回空数组

**原因**: Token 过期或 Controller 使用了错误的字段名

**解决**:
1. 重新登录获取新 token
2. 确认 Controller 使用 `req.user.id` 而非 `req.user.userId`

### Q2: 创建会话返回 403

**原因**: 未订阅该员工或订阅已过期

**解决**:
1. 前往"雇佣管理"查看订阅状态
2. 选择已订阅的员工创建会话

### Q3: 配额扣费未生效

**原因**: AI 对话未完成或计费服务异常

**解决**:
1. 等待 AI 响应完成（SSE `event: done`）
2. 查看后端日志确认计费流程执行
3. 刷新配额页面

### Q4: 交易记录为空

**原因**: 未发起任何对话或配额 ID 不匹配

**解决**:
1. 至少发起一次对话
2. 确认查询的配额 ID 正确

---

## 开发者工具验证脚本

```javascript
// 1. 获取当前 token
const token = localStorage.getItem('access_token');

// 2. 查询配额
fetch('http://localhost:3001/compute-quota', {
  headers: { 'Authorization': `Bearer ${token}` }
}).then(r => r.json()).then(console.log);

// 3. 查询订阅
fetch('http://localhost:3001/subscriptions', {
  headers: { 'Authorization': `Bearer ${token}` }
}).then(r => r.json()).then(console.log);

// 4. 创建会话
fetch('http://localhost:3001/conversations', {
  method: 'POST',
  headers: {
    'Authorization': `Bearer ${token}`,
    'Content-Type': 'application/json'
  },
  body: JSON.stringify({ employeeId: 'demo-emp-research' })
}).then(r => r.json()).then(console.log);

// 5. 查询配额详情
fetch('http://localhost:3001/compute-quota/acme-quota-free', {
  headers: { 'Authorization': `Bearer ${token}` }
}).then(r => r.json()).then(data => {
  console.log('Quota:', data.id, data.type);
  console.log('Used:', data.usedTokens, '/', data.totalTokens);
  console.log('Transactions:', data.transactions?.length || 0);
});
```

---

## 总结

通过以上步骤，你可以在前端完整验证 P2 计算配额系统的所有功能：

1. ✅ 配额查询与显示
2. ✅ 配额预检（乐观检查）
3. ✅ 配额消费（优先级扣费）
4. ✅ 交易记录追踪
5. ✅ 配额告警机制

**当前状态**: 
- 后端 API 已完成，E2E 测试通过
- 前端页面需根据现有 UI 组件实现以上功能

如需前端实现，参考：
- `/enterprise/dashboard` 的卡片布局
- `/enterprise/subscriptions` 的列表展示
- TanStack Query 的数据获取模式
