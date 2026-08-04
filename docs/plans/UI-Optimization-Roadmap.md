# 硅基员工平台 UI/UX 优化路线图

> **基于**: UIUX-frontend-v1.md  
> **目标**: 全面提升企业端和运营端的视觉与交互体验  
> **参考**: Dify（简洁专业）+ Linear（交互体验）+ Vercel（现代感）

---

## 📋 总体策略

### 优化原则
1. **渐进式优化** — 先修复明显问题，再追求极致体验
2. **高 ROI 优先** — 优先优化高频页面和核心流程
3. **保持一致性** — 所有页面遵循统一的设计语言
4. **注重反馈** — 每个操作都有清晰的视觉响应

### 成功指标
- **视觉一致性**: 90%+ 的组件遵循设计规范
- **交互流畅度**: 页面切换 < 200ms，操作响应 < 150ms
- **用户满意度**: 内部测试无明显痛点
- **无障碍达标**: WCAG 2.1 AA 级别

---

## 🎨 Phase 1: 设计系统基础（1-2天）

### 1.1 Tailwind 主题配置

**任务**: 将设计规范中的 Design Token 配置到 Tailwind

```typescript
// web/tailwind.config.ts
export default {
  theme: {
    extend: {
      colors: {
        primary: { /* 蓝色系，完整色阶 */ },
        neutral: { /* 灰色系 */ },
        success: { /* 绿色 */ },
        warning: { /* 黄色 */ },
        error: { /* 红色 */ },
        status: {
          online: '#22C55E',
          busy: '#EAB308',
          offline: '#94A3B8',
        },
        capability: {
          agent: '#3B82F6',
          skill: '#22C55E',
          rpa: '#F97316',
          aiapp: '#A855F7',
        },
      },
      spacing: { /* 基于 4px 网格 */ },
      borderRadius: {
        'sm': '4px',
        'md': '6px',
        'lg': '8px',
        'xl': '12px',
      },
      boxShadow: {
        'card': '0 1px 2px 0 rgba(0, 0, 0, 0.05)',
        'card-hover': '0 4px 6px -1px rgba(0, 0, 0, 0.1)',
        'modal': '0 10px 15px -3px rgba(0, 0, 0, 0.1)',
      },
      animation: {
        'skeleton': 'skeleton 1.5s infinite',
        'pulse-slow': 'pulse 2s infinite',
        'slide-in': 'slideIn 200ms ease-out',
        'fade-in': 'fadeIn 150ms ease-out',
      },
    },
  },
}
```

**产出**: `web/tailwind.config.ts` 更新完成

---

### 1.2 补齐缺失的基础组件

#### ✅ 已有组件（需统一样式）
- Button, Input, Card, Dialog, Badge, Switch, Select, Tabs
- Avatar, Toast, Dropdown Menu, Alert Dialog

#### ❌ 缺失组件（需新增）

**P0 必需**:
```
- Skeleton（骨架屏）
- Drawer（抽屉，宽度 600px）
- Steps（步骤条，用于招聘流程）
- StatusDot（状态指示器，在线/忙碌/离线）
- EmptyState（空状态）
- ConfirmDialog（确认对话框）
- Table（数据表格，含排序）
```

**实施顺序**:
1. **Skeleton** — 替换所有 Spinner，提升加载体验
2. **EmptyState** — 统一空状态设计
3. **StatusDot** — 员工状态展示
4. **Drawer** — 员工详情、任务详情
5. **Steps** — 招聘入职流程
6. **ConfirmDialog** — 危险操作确认
7. **Table** — 数据列表（成员、任务、审核）

**参考实现**:
- Shadcn/ui 官方示例
- Radix UI Primitives
- Headless UI

---

### 1.3 组件样式统一

**问题**: 当前组件样式不统一，部分组件未遵循设计规范

**统一检查清单**:
- [ ] 所有按钮：高度 40px，圆角 6px，padding 8px 16px
- [ ] 所有输入框：高度 40px，边框 Neutral 300，focus 时 Primary 500
- [ ] 所有卡片：圆角 8px，内边距 24px，阴影 shadow-card
- [ ] 所有字体：14px 正文，16px 小标题，18px 区块标题，24px 页面标题
- [ ] 所有间距：遵循 4px 网格（4/8/12/16/24/32/48）

**实施方式**:
1. 创建 `web/src/styles/components.css` — 全局组件样式
2. 创建 `web/src/lib/cn.ts` — 样式合并工具
3. 逐个组件检查并修复

---

## 🖼️ Phase 2: 页面级优化（3-5天）

### 2.1 高频页面优化（P0）

#### Dashboard（工作台）

**当前问题**:
- 指标卡片样式不统一
- 图表配色不符合设计规范
- 缺少空状态

**优化目标**:
```
┌────────────────────────────────────────┐
│ 工作台                         [刷新] │
├────────────────────────────────────────┤
│ ┌──────┬──────┬──────┬──────┐         │
│ │在线12│任务68│算力1K│成功率│  ← 指标卡片（4列）
│ └──────┴──────┴──────┴──────┘         │
│                                        │
│ ┌────────────────────────────────────┐│
│ │ 算力消耗趋势   [7天|30天|90天]    ││  ← 图表卡片
│ │ (LineChart)                        ││
│ └────────────────────────────────────┘│
│                                        │
│ ┌────────────────────────────────────┐│
│ │ 待处理事项                         ││
│ │ • 3 个跨部门申请待审批             ││
│ │ • 2 个能力待审核                   ││
│ └────────────────────────────────────┘│
└────────────────────────────────────────┘
```

**实施清单**:
- [ ] 创建 `MetricCard` 组件（带趋势指示器）
- [ ] 统一 recharts 配色和样式
- [ ] 添加空状态（"暂无数据"）
- [ ] 添加骨架屏加载状态

---

#### 我的员工

**当前问题**:
- 员工卡片布局不够清晰
- 缺少状态指示器（在线/离线）
- 无权限状态不明显

**优化目标**:
```
┌──────────────────────────┐
│ ●在线              [⋯]   │  ← 状态 + 菜单
│      [头像 100×100]      │
│    销售助理小李          │
│    销售部 | #EMP001      │
├──────────────────────────┤
│ 今日任务          15 个  │  ← 统计数据
│ 本周完成          68 个  │
│ 平均耗时       2.3 分钟  │
├──────────────────────────┤
│  [查看详情]   [⚙ 配置]   │
└──────────────────────────┘
```

**实施清单**:
- [ ] 重构 `EmployeeCard` 组件
- [ ] 添加 `StatusDot` 组件（在线/忙碌/离线）
- [ ] 优化统计数据展示
- [ ] 无权限状态用灰色遮罩 + 锁图标
- [ ] 添加卡片 hover 动画（上移 2px + 阴影）

---

#### 任务中心

**当前问题**:
- 任务列表缺少视觉层级
- 执行状态不够直观
- 缺少实时更新反馈

**优化目标**:
```
┌────────────────────────────────────────┐
│ 任务中心          [全部|执行中|已完成]│
├────────────────────────────────────────┤
│ ┌────────────────────────────────────┐│
│ │ ⚡ #244 生成销售话术               ││  ← 执行中（黄色）
│ │    销售助理小李 · 2 分钟前         ││
│ │    ▓▓▓▓▓▓░░░░ 65%                 ││
│ └────────────────────────────────────┘│
│                                        │
│ ┌────────────────────────────────────┐│
│ │ ✓ #243 客户需求分析                ││  ← 已完成（绿色）
│ │    销售助理小李 · 10 分钟前        ││
│ │    耗时 2.3 分钟                   ││
│ └────────────────────────────────────┘│
└────────────────────────────────────────┘
```

**实施清单**:
- [ ] 创建 `TaskCard` 组件
- [ ] 添加状态图标和颜色（执行中/已完成/失败）
- [ ] 添加进度条组件
- [ ] 点击卡片打开 `TaskTraceDrawer`（执行详情）
- [ ] WebSocket 推送时高亮变化（背景闪烁动画）

---

### 2.2 核心流程优化（P1）

#### 人才市场

**优化目标**:
- 左侧分类导航（树形结构，可折叠）
- 右侧员工卡片网格（280px × 240px）
- 卡片 hover 效果（上移 4px + 阴影加深）
- 点击卡片打开 `EmployeeDetailDrawer`

**实施清单**:
- [ ] 创建 `CategoryTree` 组件
- [ ] 重构 `EmployeeMarketCard` 组件
- [ ] 创建 `EmployeeDetailDrawer` 组件（宽度 600px）
- [ ] 添加筛选器（行业、岗位、价格）

---

#### 招聘入职流程

**优化目标**:
- Modal 宽度 800px
- 步骤条（5 步：基本/运行/知识/模型/权限）
- 表单验证（实时提示）
- 单选卡片样式（运行环境选择）

**实施清单**:
- [ ] 创建 `RecruitmentWizard` 组件
- [ ] 集成 `Steps` 组件
- [ ] 表单验证（react-hook-form + zod）
- [ ] 添加上一步/下一步按钮
- [ ] 最后一步显示配置预览

---

#### 审核中心

**优化目标**:
- 左右分屏布局（40% 列表 + 60% 详情）
- 列表项支持未读标记
- 审核检查清单（黄色警告框）
- 底部固定操作栏（通过/拒绝）

**实施清单**:
- [ ] 创建 `ReviewSplitLayout` 组件
- [ ] 列表项添加未读标记（蓝色圆点）
- [ ] 详情区添加审核清单
- [ ] 通过/拒绝操作需要确认对话框

---

### 2.3 管理功能优化（P2）

#### 组织管理

**优化目标**:
- 部门树形结构（可展开/折叠）
- 成员列表（带头像、角色标签）
- 批量操作（选中多个成员）

#### 权限管理

**优化目标**:
- 权限矩阵表格（首列固定，横向滚动）
- Checkbox 单元格居中对齐
- 部门行加粗显示

#### 能力绑定

**优化目标**:
- 拖拽排序（@dnd-kit）
- 拖拽手柄 ⣿
- 拖拽中半透明 + 阴影
- 放置位置蓝色指示线

---

## 🎭 Phase 3: 交互增强（2-3天）

### 3.1 加载状态优化

**全局替换 Spinner 为 Skeleton**:

```typescript
// 现在（❌）
{isLoading && <Spinner />}

// 优化后（✅）
{isLoading ? <EmployeeCardSkeleton count={6} /> : <EmployeeList />}
```

**实施清单**:
- [ ] 创建各页面的 Skeleton 组件
- [ ] 卡片列表 → CardSkeleton
- [ ] 表格 → TableSkeleton（5 行占位）
- [ ] 详情页 → DetailSkeleton
- [ ] 页面切换显示顶部进度条（NProgress）

---

### 3.2 实时反馈

**WebSocket 推送视觉反馈**:

```typescript
// 数据更新高亮动画
@keyframes highlight {
  0% { background: #DBEAFE; }
  100% { background: transparent; }
}

.data-updated {
  animation: highlight 1s ease-out;
}
```

**实施清单**:
- [ ] WebSocket 重连成功时顶部显示绿色提示条（2秒后消失）
- [ ] 任务状态变化时卡片高亮 1 秒
- [ ] 新任务出现时从顶部滑入
- [ ] 员工状态变化时平滑过渡（300ms）

---

### 3.3 错误处理

**友好的错误提示**:

```typescript
// 页面级错误
<EmptyState
  icon="error"
  title="出错了"
  description="加载数据时遇到问题，请稍后重试"
  actions={[
    { label: "刷新页面", onClick: refresh },
    { label: "返回首页", onClick: goHome, variant: "secondary" },
  ]}
/>

// 表单字段错误
<Input
  error="邮箱格式不正确"
  aria-invalid="true"
  aria-describedby="email-error"
/>
<span id="email-error" className="text-error-600 text-xs">
  ⚠ 邮箱格式不正确
</span>
```

**实施清单**:
- [ ] 统一错误提示样式
- [ ] API 错误显示 Toast（带重试按钮）
- [ ] 表单验证错误实时显示
- [ ] 404/500 页面优化

---

### 3.4 空状态设计

**各页面空状态**:

| 页面 | 插图 | 主文案 | 操作 |
|------|------|--------|------|
| 我的员工 | 📦 | 还没有招聘任何员工 | [+ 去人才市场] |
| 任务中心 | 📋 | 还没有任务记录 | [发起任务] |
| 知识库 | 📚 | 还没有创建知识库 | [+ 创建知识库] |
| 审核中心 | ✅ | 太好了，没有待审核事项 | 无 |
| 搜索无结果 | 🔍 | 没有找到匹配的结果 | [清除筛选] |

**实施清单**:
- [ ] 创建 `EmptyState` 组件
- [ ] 准备 5-8 个空状态插图（SVG）
- [ ] 每个列表页面添加空状态

---

### 3.5 确认对话框

**危险操作二次确认**:

```typescript
<ConfirmDialog
  icon="warning"
  title="确认停用该员工？"
  description="停用后，所有成员将无法向该员工发起新任务。已在执行的任务会继续完成。"
  note="此操作可以撤销。"
  confirmLabel="确认停用"
  confirmVariant="danger"
  onConfirm={handleDeactivate}
/>
```

**高危操作需要输入确认**:

```typescript
<ConfirmDialog
  title="确认冻结企业？"
  description="冻结后企业所有成员将无法使用平台。"
  requireConfirmText="龙道集团"
  confirmLabel="确认冻结"
  onConfirm={handleFreeze}
/>
```

**实施清单**:
- [ ] 创建 `ConfirmDialog` 组件
- [ ] 删除、停用、拒绝等操作添加确认
- [ ] 高危操作（冻结企业）需要输入确认

---

## 💎 Phase 4: 细节打磨（1-2天）

### 4.1 无障碍优化

**键盘导航**:
- [ ] 所有交互元素可 Tab 遍历
- [ ] Modal/Drawer 打开时焦点陷阱
- [ ] Esc 键关闭浮层
- [ ] ↑↓ 键在下拉菜单中导航

**ARIA 标签**:
- [ ] 图标按钮添加 `aria-label`
- [ ] 表单字段关联 `label`
- [ ] 错误提示使用 `aria-describedby`
- [ ] 实时更新使用 `aria-live="polite"`

**颜色对比度**:
- [ ] 检查所有文字与背景对比度 ≥ 4.5:1
- [ ] 状态不仅用颜色，还有图标/文字

---

### 4.2 性能优化

**虚拟滚动**:
```typescript
import { useVirtualizer } from '@tanstack/react-virtual'

// 长列表（>1000 条）使用虚拟滚动
const rowVirtualizer = useVirtualizer({
  count: tasks.length,
  getScrollElement: () => parentRef.current,
  estimateSize: () => 72,
})
```

**图片优化**:
```typescript
import Image from 'next/image'

// 使用 Next.js Image 组件
<Image
  src={employee.avatar}
  alt={employee.name}
  width={100}
  height={100}
  className="rounded-full"
/>
```

**动画优化**:
```css
/* 使用 transform 和 opacity（GPU 加速） */
.card-hover {
  transform: translateY(-2px);
  transition: transform 200ms ease-out;
}

/* ❌ 避免使用 top/left/margin */
```

**实施清单**:
- [ ] 长列表使用虚拟滚动
- [ ] 图片使用 `next/image`
- [ ] 动画使用 `transform` / `opacity`
- [ ] 懒加载图表组件（React.lazy）

---

### 4.3 响应式调整

**断点策略**:
- Desktop (≥ 1280px): 标准布局
- Tablet (768-1279px): 缩小侧边栏至 60px（仅图标）
- Mobile (< 768px): 显示"请在桌面端访问"提示

**实施清单**:
- [ ] Desktop 优先开发
- [ ] Tablet 适配（侧边栏折叠）
- [ ] Mobile 显示友好提示

---

## 🎯 快速见效优化（可立即实施）

### Quick Win 1: 统一色彩系统（30分钟）

```bash
# 更新 Tailwind 配置
cd web
# 编辑 tailwind.config.ts，添加设计规范中的色彩
```

### Quick Win 2: 添加 Skeleton（1小时）

```bash
# 创建 Skeleton 组件
# 替换所有加载 Spinner
```

### Quick Win 3: 统一间距（1小时）

```bash
# 全局搜索替换间距类名
# px-3 → px-4 (16px)
# py-2 → py-3 (12px)
# gap-2 → gap-4 (16px)
```

### Quick Win 4: 添加空状态（1小时）

```bash
# 创建 EmptyState 组件
# 在所有列表页面添加
```

### Quick Win 5: 优化按钮样式（30分钟）

```bash
# 统一按钮高度、圆角、内边距
# 添加 hover 动画
```

---

## 📊 效果评估

### 优化前后对比

| 指标 | 优化前 | 优化后目标 |
|------|--------|-----------|
| 视觉一致性 | 60% | 90%+ |
| 加载体验 | Spinner | Skeleton |
| 空状态覆盖 | 30% | 100% |
| 交互反馈 | 不完整 | 完整 |
| 页面切换 | 白屏 | 骨架屏 |
| 无障碍 | 不达标 | WCAG AA |

### 验收标准

- [ ] 所有页面遵循设计规范
- [ ] 所有组件有 hover/focus 状态
- [ ] 所有异步操作有加载状态
- [ ] 所有列表有空状态
- [ ] 所有危险操作有确认
- [ ] 键盘导航正常
- [ ] 颜色对比度达标

---

## 🛠️ 实施建议

### 开发流程

1. **设计系统优先** — 先建立基础，再优化页面
2. **组件先行** — 先完善基础组件，再组合页面
3. **高频优先** — 先优化常用页面，再完善细节
4. **增量交付** — 每完成一个 Phase 就合并，不要等全部完成

### 协作方式

1. **设计规范** — 基于 UIUX-frontend-v1.md
2. **组件库** — Shadcn/ui + 自定义组件
3. **代码审查** — 每个组件完成后 Code Review
4. **内部测试** — 每个 Phase 完成后内部使用测试

### 时间估算

- Phase 1（设计系统）: 1-2 天
- Phase 2（页面优化）: 3-5 天
- Phase 3（交互增强）: 2-3 天
- Phase 4（细节打磨）: 1-2 天

**总计**: 7-12 天（1-2 周）

---

## 🎁 参考资源

### 设计参考
- [Linear](https://linear.app) — 交互体验
- [Vercel Dashboard](https://vercel.com/dashboard) — 视觉风格
- [Stripe Dashboard](https://dashboard.stripe.com) — 信息架构
- [Dify](https://dify.ai) — 简洁专业

### 组件库
- [Shadcn/ui](https://ui.shadcn.com/)
- [Radix UI](https://www.radix-ui.com/)
- [Headless UI](https://headlessui.com/)

### 图标
- [Lucide Icons](https://lucide.dev/)
- [Heroicons](https://heroicons.com/)

### 动画
- [Framer Motion](https://www.framer.com/motion/)
- [Auto Animate](https://auto-animate.formkit.com/)

---

**下一步行动**: 选择一个 Phase 开始实施，建议从 Phase 1 的 Tailwind 配置开始。
