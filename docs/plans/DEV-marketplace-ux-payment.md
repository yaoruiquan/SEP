# 开发文档：人才市场重设计 + 订阅支付下载链路

> 撰写日期：2026-08-04  
> 涉及任务：#93 人才市场UX优化、#94 订阅→支付→下载全链路

---

## 一、调研现状

### 1.1 人才市场筛选面板（`filter-panel.tsx`）

| 项目 | 现状 | 问题 |
|------|------|------|
| 价格筛选 | `<input type="range" min=0 max=2000 step=100>` | 滑块精度差，不直观；用户不知道具体档位 |
| 能力类型 | HTML checkbox，无勾选计数 | 选了几个类型无视觉反馈 |
| 筛选状态 | `dirty` = category ∥ capTypes.length > 0 ∥ maxPrice < 2000 | 逻辑正确，保留不动 |

导出常量：`PRICE_MAX = 2000`、`INITIAL_FILTERS`、`FilterState`（`{search, category, capTypes, maxPrice}`）  
这三者被 `marketplace/page.tsx` 引用 —— 改内部实现，**接口不变**。

### 1.2 员工卡片（`employee-card.tsx`）

| 项目 | 现状 | 问题 |
|------|------|------|
| 已订阅视觉 | 仅头部区域显示 "✓ 已入职" 小徽标 | 卡片边框和订阅按钮在 hover 前完全看不出已订阅 |
| 订阅按钮 | `opacity-0 group-hover:opacity-100` | 已订阅时显示「管理」按钮，逻辑正确 |
| 能力标签 | 静态 `border-glassline bg-glass-2` | 无 hover 动效，点击感不足 |

### 1.3 订阅流程现状

**`marketplace/page.tsx`**：
```ts
function doSubscribe(emp) {
  subscribe.mutate(emp.id, { onSuccess: ..., onError: ... });
}
// 卡片 onSubscribe={() => doSubscribe(emp)}
// 抽屉 onSubscribe={() => drawerEmp && doSubscribe(drawerEmp)}
```

**`marketplace/[id]/page.tsx`**：
```tsx
<Button onClick={() => subscribe.mutate(emp.id, { ... })}>订阅该员工</Button>
```

两处都是**直接调用 API，无任何支付步骤**。

### 1.4 下载流程现状

| 环节 | 路径 | 状态 |
|------|------|------|
| 前端 hook | `web/src/features/employee/use-packages.ts` → `downloadFile('/digital-employees/:id/package/download')` | ✅ 已实现 |
| 后端端点 | `GET /digital-employees/:id/package/download` @ `package.controller.ts:148` | ✅ 已实现 |
| 下载按钮 | `my-employees/page.tsx` 中条件渲染：`{packageAvailable && <Button>下载到本地</Button>}` | ✅ 已实现 |
| **Demo 数据** | `seed-demo.ts` 无任何 `EmployeePackage` 记录 | ❌ 缺失 → `packageAvailable = false` → 按钮不出现 |

**`packageAvailable` 计算路径**：  
`grant.service.ts:297` → `withPackage.has(r.template.id)`  
→ `withPackage` = 「在 `EmployeePackage` 表中有至少一条 `storagePath != null` 记录的 templateId 集合」

**文件存储根目录**：  
`backend/storage/packages/` （可由 `PACKAGE_STORAGE_PATH` 环境变量覆盖）

---

## 二、改动范围

```
web/src/app/(market)/marketplace/
  _components/filter-panel.tsx          # Phase 1
  _components/employee-card.tsx         # Phase 2
  page.tsx                              # Phase 3（引入 PaymentModal）
  [id]/page.tsx                         # Phase 3（引入 PaymentModal）

web/src/components/ui/
  payment-modal.tsx                     # Phase 3（新建）

backend/prisma/
  seed.ts                               # Phase 4（补充 demo 包数据）
```

影响范围说明：
- Phase 1/2：纯前端组件内部改动，无 API 变化，低风险
- Phase 3：新增一个 UI 组件，两处入口改为先开模态框再调接口；**不改后端**
- Phase 4：仅改 seed 脚本，生产代码零变更

---

## 三、分阶段开发计划

### Phase 1：筛选面板 UX（`filter-panel.tsx`）

**目标**：让筛选更直觉化

#### 1.1 价格筛选 → 4 个 Pill 按钮

替换 `<input type="range">` 为 4 个互斥按钮：

| 按钮标签 | `maxPrice` 值 | 语义 |
|----------|--------------|------|
| 免费 | `0` | 只看免费（price = 0） |
| ¥100 以下 | `100` | 含免费 + 低价 |
| ¥100–500 | `500` | 中价位 |
| 不限 | `PRICE_MAX (2000)` | 全部 |

> 筛选逻辑 `(emp.price ?? 0) > filters.maxPrice` 已在 `page.tsx` 中，无需改动。  
> 免费选项：`maxPrice=0` → 只有 price=0 或 price=null 的通过。

选中样式：`bg-gbrand/15 text-gbrand-text border-glassline-brand`  
未选样式：`text-gtext-secondary hover:bg-glass-2`

#### 1.2 能力类型 → 带计数徽标

section 标题行改为：
```
能力类型          [已选 N]   ← 只在 N>0 时出现
```
徽标样式：`bg-gbrand/15 text-gbrand-text text-[10px] px-1.5 py-0.5 rounded-full`

checkboxes 本身保持不变（样式已经是 glassmorphism 风格，无需大改）。

---

### Phase 2：员工卡片 UX（`employee-card.tsx`）

**目标**：已订阅状态一眼可识别，能力标签有交互感

#### 2.1 已订阅 → 永久绿色边框

```tsx
<article className={cn(
  'glass-card group relative flex cursor-pointer flex-col gap-4 p-5',
  'transition-all duration-300',
  'hover:-translate-y-1 hover:shadow-glass-xl hover:border-glassline-hover',
  subscribed && 'border-emerald-500/40 shadow-[0_0_0_1px_rgb(16_185_129_/_0.2)]',
)}>
```

当 `subscribed=true` 时，边框从透明变为淡绿，即使不 hover 也可见。

#### 2.2 能力标签 hover 动效

```tsx
<span
  key={t}
  className={cn(
    'rounded-full border border-glassline bg-glass-2 px-2 py-0.5 text-[11px] text-gtext-secondary',
    'transition-all duration-150',
    'hover:border-gbrand/40 hover:bg-gbrand/10 hover:text-gbrand-text hover:scale-105',
  )}
>
```

轻微缩放 + 品牌色高亮，不影响布局（`scale-105` 加在 span 上不改变 flow）。

---

### Phase 3：支付模态框（新建 + 接入）

**目标**：点「订阅」先弹出假支付框，确认后才调接口

#### 3.1 `payment-modal.tsx` 设计

```
┌─────────────────────────────────────────────────────┐
│  [X]   确认订阅                                      │
│                                                     │
│  员工名称：「XXX」                                   │
│  订阅费用：¥ 299 / 月   或   免费                    │
│                                                     │
│  支付方式                                            │
│  [● 信用卡 / 借记卡]   ○ 余额支付                    │
│                                                     │
│  卡号   [  4242  4242  4242  4242        ]          │
│  有效期 [ 12/28 ]   CVV [ 123 ]                     │
│                                                     │
│  ────────────────────────────────────────────────  │
│                                                     │
│  [取消]                          [确认支付  →]       │
└─────────────────────────────────────────────────────┘
```

- 样式：glassmorphism，`glass-card p-6`，backdrop blur
- 字段：纯 display，**不做真实验证**（只判断是否填写了卡号，用于演示）
- 免费员工：不显示卡号区域，按钮文案改为「免费订阅」
- 加载状态：确认按钮 disabled + spinner

**Props 接口**：
```ts
interface PaymentModalProps {
  open: boolean;
  emp: { name: string; price?: number | null };
  subscribing: boolean;
  onConfirm: () => void;
  onClose: () => void;
}
```

#### 3.2 接入 `marketplace/page.tsx`

```
原：doSubscribe(emp) → subscribe.mutate(...)
新：doSubscribe(emp) → setPayingEmp(emp)  [打开 modal]
    modal onConfirm  → subscribe.mutate(...)  [调 API]
    subscribe 成功   → setPayingEmp(null)  [关闭 modal]
```

新增状态：`const [payingEmp, setPayingEmp] = useState<MarketEmployee | null>(null)`

#### 3.3 接入 `marketplace/[id]/page.tsx`

同理，原先直接 `subscribe.mutate` 的地方先 `setPayingOpen(true)`。

---

### Phase 4：Demo 下载数据（`seed.ts`）

**目标**：让 demo 用户能看到下载按钮并成功下载

#### 思路

在 `seed.ts` 中（不动 `seed-demo.ts`）：

1. 遍历所有已发布 (`PUBLISHED`) 的 `DigitalEmployee`
2. 检查是否已有 `EmployeePackage`，没有则：
   - 在 `backend/storage/packages/<employeeId>/` 下生成一个小 ZIP（内含 `README.txt` + `config.json`）
   - 向 `EmployeePackage` 表 upsert 一条记录，`storagePath` 指向该文件

> ZIP 生成用 Node.js 原生 zlib + 手写 ZIP 格式，或者直接用 `archiver`/`jszip`（看 package.json 是否已有）。  
> 生成的 ZIP 约 1–2 KB，仅供演示下载用。

**验收标准**：
- 运行 `pnpm db:seed` 后，`my-employees` 中至少一个员工的卡片出现「下载到本地」按钮
- 点击后浏览器下载一个 `.zip`，解压可见内容

---

## 四、验收标准汇总

| Phase | 验收点 |
|-------|--------|
| P1 | 价格4按钮：点击任意一个，页面员工列表正确过滤；默认选中「不限」 |
| P1 | 能力类型选了 2 个后，标题行出现 `[已选 2]` 徽标 |
| P2 | 已订阅的卡片在非 hover 状态下有绿色边框可见 |
| P2 | 鼠标悬停能力标签，有缩放+颜色变化动效 |
| P3 | 点「订阅」弹出 PaymentModal，展示员工名称和价格 |
| P3 | 免费员工弹出 modal 后不显示卡号区域，按钮文案为「免费订阅」 |
| P3 | 点「确认支付」后 modal 按钮进入 loading 状态，成功后 modal 关闭，toast 提示订阅成功 |
| P3 | 点「取消」关闭 modal，不调 API |
| P3 | 详情页 `/marketplace/[id]` 的订阅按钮走相同的 modal 流程 |
| P4 | seed 后，demo 企业用户的「我的员工」页至少有一张卡片显示「下载到本地」 |
| P4 | 点击下载，浏览器下载 `.zip` 文件，文件可正常解压 |

---

## 五、开发顺序建议

```
P1 → P2 → P3 → P4
```

P1/P2 独立，可同时进行。P3 依赖 UI 组件目录结构稳定即可。P4 纯 backend seed，任意顺序。

每个 Phase 完成后运行 `/ccg:verify-quality` 对应路径，确认无新增质量问题后再进入下一 Phase。
