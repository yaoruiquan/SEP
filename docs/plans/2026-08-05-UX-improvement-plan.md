# 用户体验优化五阶段开发计划

> 基于产品体验评估，针对 5 个核心问题分阶段落地。
> 计划总工期：6 个工作天

---

## 阶段总览

| Phase | 问题 | 工期 | 涉及模块 |
|-------|------|------|----------|
| P1 | 市场页搜索 | 1 天 | 前端 market |
| P2 | 订阅后引导 | 0.5 天 | 前端 market |
| P3 | 移除 Mock 数据 | 0.5 天 | 前端 enterprise |
| P4 | 消费明细页 | 2 天 | 后端 compute + 前端 enterprise |
| P5 | 运营数据看板 | 2 天 | 后端 admin + 前端 platform |

---

## Phase 1 — 市场页全文搜索（1 天）

### 问题
市场页有 156 个员工，用户只能靠类型/价格筛选器翻页，无法按关键词快速定位。

### 目标
在市场列表页添加实时搜索框，支持对员工名称、描述、技能标签的模糊匹配。

### 方案
**前端搜索（不改后端）**：市场页已通过 TanStack Query 拉取完整列表，在客户端做过滤，避免额外 API 改动，延迟更低。

如果后续员工数量超过 500，再切换为后端搜索（`GET /digital-employees?q=xxx`）。

### 实现任务

**1.1 搜索 UI 组件**
- 文件：`web/src/app/(market)/marketplace/page.tsx`
- 在筛选器行添加搜索框（Input + Search 图标）
- 搜索框 placeholder："搜索员工名称、技能..."
- debounce 300ms 触发搜索

**1.2 前端过滤逻辑**
- 修改 `useMemo` 过滤：`searchQuery` 命中 `name` / `description` / `tags[]` 任意一项即匹配
- 与现有 type/price 筛选叠加（AND 关系）

**1.3 空结果状态**
- 搜索无结果时显示友好提示 + 清除搜索建议

**1.4 搜索高亮（可选增强）**
- 匹配关键词用高亮颜色标出

### 验收标准
- [ ] 输入关键词后 300ms 内列表实时更新
- [ ] 清空搜索框后恢复完整列表
- [ ] 搜索与类型/价格筛选可同时生效
- [ ] 无结果时有友好提示

---

## Phase 2 — 订阅后流程引导（0.5 天）

### 问题
用户点击「立即订阅」→ 确认支付后，只弹出一个 Toast 提示，不知道接下来该去哪里操作。

### 目标
订阅成功后，通过引导弹窗告知用户下一步，主动降低跳出率。

### 方案
复用已有 `PaymentModal`，在 `onSuccess` 回调中弹出「订阅成功」确认弹窗（而非仅 Toast），提供两个 CTA 按钮。

### 实现任务

**2.1 订阅成功弹窗**
- 文件：`web/src/components/ui/payment-modal.tsx`
- 支付确认成功后，改为显示成功弹窗（带动画）
- 弹窗内容：
  - 大号 ✅ 图标 + "订阅成功！"
  - 「去我的员工」按钮 → `/my-employees`
  - 「继续逛市场」按钮（关闭弹窗）

**2.2 员工详情页同步**
- 文件：`web/src/app/(market)/marketplace/[id]/page.tsx`
- 详情页订阅成功后同样触发引导弹窗

**2.3 订阅状态即时更新**
- 订阅成功后 invalidate `subscriptions` query，使市场页「已订阅」状态即时变更

### 验收标准
- [ ] 订阅成功后出现引导弹窗，不再仅靠 Toast
- [ ] 「去我的员工」正确跳转
- [ ] 「继续逛市场」关闭弹窗，不跳转
- [ ] 市场卡片上的「已订阅」标记即时更新

---

## Phase 3 — 移除 Mock 数据（0.5 天）

### 问题
员工卡片上展示的「本月调用 XX 次」「本月消费 ¥XX.XX」每次刷新随机变化，「2 小时前活跃」是硬编码字符串，用户看到会失去信任。

### 目标
移除所有假数据展示，用真实数据或占位符替代，避免用户对平台产生怀疑。

### 涉及文件
- `web/src/app/(enterprise)/my-employees/EmployeeCard.tsx`
- `web/src/app/(enterprise)/my-employees/[id]/page.tsx`

### 实现任务

**3.1 清理 EmployeeCard Mock 数据**
- 移除 `Math.random()` 生成的 `mockMonthCalls` / `mockMonthSpend`
- 移除「2 小时前活跃」硬编码字符串
- 移除 `StatusDot` 在线状态指示器（WebSocket 未实现时不显示假状态）
- 替代方案：
  - 统计数据位置显示「--」或不显示该区域（待后端实现）
  - 最后活跃时间显示「创建时间」（真实数据）

**3.2 清理员工详情页 Mock 数据**
- 同步修改 `my-employees/[id]/page.tsx` 中的 Mock 统计数据

**3.3 WebSocket 状态显示规则**
- `useEmployeeStatus()` 目前返回空对象（mock）
- 当 status 无值时，卡片不显示在线状态点和状态文字（而不是显示假的「离线」）

### 验收标准
- [ ] 刷新页面，卡片上不出现随机变化的数字
- [ ] 「2 小时前活跃」已移除
- [ ] 无真实统计数据时，对应区域显示「--」或不显示
- [ ] 没有任何 Math.random() 用于展示数据

---

## Phase 4 — 消费明细页（2 天）

### 问题
用户余额会扣减（`compute_transactions` 表有记录），但前端没有提供查看明细的页面，用户不知道钱花在哪里。

### 目标
提供「消费记录」页面，展示每笔交易的时间、类型、金额，并支持筛选和导出。同时在余额低时提示充值。

### Day 1 — 后端 API 增强

**4.1 消费明细接口扩展**
- 文件：`backend/src/modules/compute/compute.controller.ts`
- 现有：`GET /compute/transactions`（已有，返回列表）
- 扩展参数：`type`（CONSUME/RECHARGE）、`startDate`、`endDate`、`page`、`pageSize`
- 返回格式：
```json
{
  "items": [
    {
      "id": "...",
      "type": "CONSUME",
      "amount": -0.05,
      "description": "与「数据分析助手」对话",
      "createdAt": "2026-08-05T10:00:00Z"
    }
  ],
  "total": 128,
  "page": 1,
  "pageSize": 20,
  "balance": 99.85,
  "monthConsume": 12.30
}
```

**4.2 充值接口**
- 现有：`POST /compute/recharge`（已有）
- 前端直接调用，不需要后端改动

**4.3 统计摘要接口优化**
- 文件：`backend/src/modules/compute/compute.service.ts`
- `getStats` 补充：`totalConsumed`（累计消费）、`monthRecharge`（本月充值）

### Day 2 — 前端页面

**4.4 消费记录页面**
- 新文件：`web/src/app/(enterprise)/billing/page.tsx`
- 路由：`/billing`

页面布局：
```
┌─────────────────────────────────────────┐
│  账户余额  ¥99.85    [充值]              │
│  本月消费  ¥12.30    本月充值  ¥0       │
├─────────────────────────────────────────┤
│  筛选：[全部 ▼]  [本月 ▼]  [导出CSV]   │
├─────────────────────────────────────────┤
│  时间         类型    金额    说明       │
│  08-05 10:00  消费   -¥0.05  数据分析   │
│  08-04 14:30  充值   +¥100   手动充值   │
│  ...                                    │
├─────────────────────────────────────────┤
│  [< 上一页]  第 1/7 页  [下一页 >]     │
└─────────────────────────────────────────┘
```

**4.5 余额预警 Banner**
- 文件：`web/src/app/(enterprise)/layout.tsx` 或企业 Shell
- 条件：`balance < 10`
- 展示：顶部橙色 Banner「账户余额不足 ¥10，请及时充值」+ [立即充值] 按钮

**4.6 充值弹窗**
- 复用 `Dialog` 组件，表单：金额输入（预设 100/500/1000 快捷金额）
- 调用 `POST /compute/recharge`，成功后刷新余额

**4.7 侧边栏导航入口**
- 文件：`web/src/components/enterprise-shell.tsx`
- 在侧边栏「计算用量」下方添加「消费记录」链接

**4.8 CSV 导出**
- 前端实现：将当前筛选结果转换为 CSV 并触发下载
- 列：时间、类型、金额、说明

**4.9 TanStack Query hooks**
- 新文件：`web/src/features/compute/use-billing.ts`
- `useBillingRecords(params)` — 消费列表
- `useRecharge()` — 充值 mutation

### 验收标准
- [ ] `/billing` 页面正常展示消费记录
- [ ] 按类型（消费/充值）和日期范围筛选有效
- [ ] 分页正常
- [ ] 余额 < 10 时顶部显示预警
- [ ] 充值弹窗可正常充值并刷新余额
- [ ] 导出 CSV 文件包含正确数据

---

## Phase 5 — 运营数据看板（2 天）

### 问题
运营管理员登录后台，首页是一个简单的管理列表，无法快速了解平台整体状况：有多少用户、哪些员工最受欢迎、今天活跃了多少企业、收入趋势如何。

### 目标
为运营端首页（`/admin`）打造一个数据看板，展示平台关键指标和趋势图表。

### Day 1 — 后端 Dashboard API

**5.1 新增 Dashboard 统计接口**
- 文件：`backend/src/modules/admin/admin.controller.ts`
- 新增：`GET /admin/dashboard`

返回数据结构：
```json
{
  "overview": {
    "totalEnterprises": 42,
    "totalUsers": 318,
    "totalEmployees": 156,
    "totalSubscriptions": 890,
    "totalCapabilities": 37,
    "platformBalance": 12450.00
  },
  "today": {
    "newSubscriptions": 5,
    "activeEnterprises": 12,
    "apiCalls": 1234,
    "revenue": 123.45
  },
  "trends": {
    "subscriptions": [
      { "date": "2026-07-30", "count": 8 },
      { "date": "2026-07-31", "count": 12 },
      ...
    ],
    "revenue": [
      { "date": "2026-07-30", "amount": 98.5 },
      ...
    ]
  },
  "topEmployees": [
    { "id": "...", "name": "数据分析助手", "subscriptions": 42, "revenue": 520.0 },
    { "id": "...", "name": "文案编辑", "subscriptions": 38, "revenue": 380.0 }
  ],
  "recentActivities": [
    { "type": "NEW_SUBSCRIPTION", "enterprise": "ACME", "employee": "数据助手", "at": "..." },
    { "type": "NEW_ENTERPRISE", "enterprise": "字节跳动", "at": "..." }
  ]
}
```

**5.2 后端 Service 实现**
- 文件：`backend/src/modules/admin/admin.service.ts`
- 使用 Prisma 聚合查询
- 订阅趋势：近 30 天按日分组
- 收入趋势：近 30 天 compute_transactions 按日汇总
- Top 员工：按订阅数排名

### Day 2 — 前端 Dashboard 页面

**5.3 重构运营端首页**
- 文件：`web/src/app/(platform)/admin/page.tsx`（当前是简单的管理跳转页）
- 改为完整 Dashboard

**页面布局：**
```
┌─────────────────────────────────────────────────────────────┐
│  欢迎回来，管理员                          最后更新 10:30   │
├──────────┬──────────┬──────────┬──────────┬────────────────┤
│  企业数  │  用户数  │  员工数  │  今日收入 │  本月收入      │
│   42     │   318    │   156    │  ¥123.45  │  ¥4,230.00    │
│  +2 今日 │  +5 今日 │          │  ↑ 23%   │  ↑ 18%        │
├──────────┴──────────┴──────────┴──────────┴────────────────┤
│  订阅趋势（近 30 天折线图）  │  收入趋势（近 30 天折线图）  │
│                              │                              │
│  ▁▂▃▅▆▇▇█▇▆▅              │  ▁▁▂▄▅▆▇█▆▅▄              │
├──────────────────────────────┴──────────────────────────────┤
│  🏆 热门员工 TOP 5           │  📋 最近动态                  │
│  1. 数据分析助手   42 订阅   │  • ACME 订阅了「文案编辑」    │
│  2. 文案编辑       38 订阅   │  • 字节跳动 完成注册          │
│  3. 客服助手       31 订阅   │  • 新能力「GPT总结」待审核    │
│  4. 销售助手       28 订阅   │  • 美团 余额不足 ¥2.5        │
│  5. HR 顾问        22 订阅   │                              │
└──────────────────────────────┴──────────────────────────────┘
```

**5.4 图表实现**
- 使用已安装的 `recharts` 库
- 订阅趋势：`LineChart`
- 收入趋势：`AreaChart`（面积图，视觉更直观）
- 热门员工：`BarChart`（水平条形图）

**5.5 TanStack Query hooks**
- 新文件：`web/src/features/admin/use-admin-dashboard.ts`
- `useAdminDashboard()` — staleTime: 60s，后台自动刷新
- 数据自动每 60 秒更新一次（`refetchInterval: 60_000`）

**5.6 响应式布局**
- 大屏：6 列指标卡片 + 双栏图表
- 小屏：2 列指标卡片 + 单栏图表

### 验收标准
- [ ] `/admin` 首页展示完整 Dashboard
- [ ] 6 个指标卡片数据真实（来自 DB）
- [ ] 订阅趋势折线图展示近 30 天数据
- [ ] 收入趋势面积图展示近 30 天数据
- [ ] Top 5 热门员工排名准确
- [ ] 最近动态列表展示最新操作
- [ ] 数据每 60 秒自动刷新
- [ ] 响应式布局在小屏正常

---

## 开发顺序与时间安排

```
Day 1 (上午): Phase 1 — 市场搜索
Day 1 (下午): Phase 2 + Phase 3 — 订阅引导 + 清理 Mock 数据
Day 2-3:      Phase 4 — 消费明细（后端 Day 2 上午 / 前端 Day 2 下午~Day 3）
Day 4-5:      Phase 5 — 运营看板（后端 Day 4 / 前端 Day 5）
Day 6:        集成测试 + Bug 修复 + 提交
```

---

## 技术约束

- 前端：Next.js 15 App Router，TanStack Query v5，recharts ^3.10（已安装）
- 后端：NestJS + Prisma + PostgreSQL
- 样式：Glassmorphism 设计系统（glass-card-interactive、bg-glass-*、text-gtext-* 等 token）
- 不新增任何 npm 依赖（已有 recharts、date-fns、react-hook-form 足够用）

---

## 不在本计划范围内

- 聊天功能
- WebSocket 实时状态
- 真实支付集成
- 移动端适配
