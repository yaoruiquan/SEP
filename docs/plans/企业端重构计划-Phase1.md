# 企业端彻底重构计划 - Phase 1

## 📊 现状分析

### 当前实现的问题

#### 1. **布局不符合设计文档**
- ❌ **文档要求**: 240px 固定宽度侧边栏 + 主内容区
- ✅ **当前实现**: `w-60` (240px) 侧边栏，但样式不够精细
- ❌ **缺失**: 侧边栏没有固定高度的 logo 区域（文档要求 64px）
- ❌ **缺失**: 没有实时状态指示器（WebSocket 连接状态、员工在线状态）

#### 2. **Dashboard 不符合规范**
文档要求的 MetricCard 组件特征：
- 图标 + 标题 + 数值 + 趋势指示器（↑/↓ + 百分比）
- 4 个关键指标：员工数、成员数、本月消费、本月调用

当前实现：
- ✅ 有 StatsCard 组件
- ❌ 但**没有趋势指示器**
- ❌ 没有同比/环比数据
- ❌ 图表样式不够 Dify 风格（需要更柔和的配色）

#### 3. **缺失的核心业务组件**
- ❌ **StatusDot**: 实时状态指示器（员工在线/离线、WebSocket 连接状态）
- ❌ **EmptyState**: 空状态组件有，但没有插图
- ❌ **Skeleton**: 骨架屏（目前只有 Spinner）
- ❌ **TracePanel**: 任务执行面板（实时更新）
- ❌ **PermissionMatrix**: 权限矩阵表格
- ❌ **CapabilityBindingList**: 拖拽排序能力列表

#### 4. **"我的员工"页面问题**
文档要求：
- 卡片式布局（3 列网格）
- 每张卡片：头像 + 名称 + 状态指示器 + 能力标签 + 操作按钮
- 实时状态更新（WebSocket）

当前实现：
- ✅ 有卡片布局
- ❌ 没有实时状态指示器
- ❌ 卡片样式过于简单（缺少视觉层次）
- ❌ 没有能力标签的视觉设计

#### 5. **任务中心缺失实时更新**
文档要求：
- TracePanel 组件显示执行链路
- 实时状态更新（WebSocket）
- 执行日志流式展示

当前实现：
- ✅ 有任务列表
- ❌ 没有实时更新
- ❌ 没有 TracePanel

---

## 🎯 重构目标

### 核心原则
1. **100% 遵循设计文档** `/Users/yao/LLM/SEP/docs/plans/UIUX-frontend-v1.md`
2. **Dify 风格**: 柔和配色、细腻阴影、微妙交互
3. **实时状态**: WebSocket 连接状态 + 员工在线状态
4. **视觉反馈**: 每个操作都有即时的视觉反馈

### 衡量标准
- ✅ 老板打开后能立刻感受到视觉差异
- ✅ 每个关键页面都有"wow"时刻
- ✅ 实时状态让人感觉"活着"

---

## 📋 分阶段执行计划

### **Phase 1.1: 基础设施层** (P0 - 必做)

#### 1.1.1 新建核心组件
```
web/src/components/ui/
├── status-dot.tsx          # 状态指示器（在线/离线/连接中）
├── skeleton.tsx            # 骨架屏（卡片、列表、文本）
├── empty-state.tsx         # 增强版空状态（带插图）
└── metric-card.tsx         # Dashboard 指标卡片（带趋势）
```

**StatusDot 组件规范**:
```typescript
// 支持 3 种状态 + 动画
<StatusDot status="online" />    // 绿色圆点 + 呼吸动画
<StatusDot status="offline" />   // 灰色圆点
<StatusDot status="busy" />      // 黄色圆点 + 脉冲动画
```

**MetricCard 组件规范**:
```typescript
<MetricCard
  title="AI 员工"
  value={12}
  trend={{ direction: 'up', value: 20 }} // ↑ 20%
  icon={<Bot />}
/>
```

#### 1.1.2 WebSocket 基础设施
```
web/src/lib/
├── websocket.ts            # WebSocket 连接管理
└── use-realtime-status.ts  # 实时状态 Hook
```

**实时状态系统**:
- WebSocket 连接状态指示器（右上角）
- 员工在线状态实时更新
- 任务执行状态推送

---

### **Phase 1.2: 侧边栏重构** (P0)

#### 目标
完全按照文档规范重新实现侧边栏：
- 固定 64px 高度的 Logo 区域
- 分组导航（带分割线）
- 用户信息区域（底部固定）
- WebSocket 连接状态指示器

#### 文件修改
- `/Users/yao/LLM/SEP/web/src/components/shell/enterprise-shell.tsx`

#### 设计细节
```
┌─────────────────────────┐
│ Logo + 企业名 + 状态灯   │ ← 64px 高度，带 WebSocket 状态
├─────────────────────────┤
│ 【工作台】              │
│ ━━━━━━━━━━━━━━━━━━━━━  │ ← 分割线
│ 组织                    │
│   部门管理              │
│   成员管理              │
│ ━━━━━━━━━━━━━━━━━━━━━  │
│ 员工                    │
│   我的员工              │
│   员工市场              │
│   员工实例              │
│   我的订阅              │
│ ━━━━━━━━━━━━━━━━━━━━━  │
│ ...                     │
├─────────────────────────┤
│ 用户头像 + 名称          │ ← 底部固定
│ 个人设置                │
│ 退出登录                │
└─────────────────────────┘
```

**关键改进**:
1. Logo 区域右上角加 StatusDot（WebSocket 连接状态）
2. 导航组之间加细分割线（`border-t border-neutral-100`）
3. 当前路由高亮更明显（左侧 4px 蓝色边框）

---

### **Phase 1.3: Dashboard 重构** (P0)

#### 目标
让 Dashboard 有"wow"时刻：
- MetricCard 组件带趋势指示器
- 图表配色更柔和（Dify 风格）
- 添加骨架屏加载状态
- 空状态带插图

#### 文件修改
- `/Users/yao/LLM/SEP/web/src/app/(enterprise)/dashboard/page.tsx`
- 新建 `/Users/yao/LLM/SEP/web/src/components/dashboard/metric-card.tsx`

#### 设计细节

**1. MetricCard 布局**:
```
┌──────────────────────┐
│ 💼 AI 员工      ↑ 20%│ ← 标题 + 趋势（绿色向上箭头）
│ 12               员工│ ← 大号数值 + 单位
└──────────────────────┘
```

**2. 图表配色** (Dify 风格):
- 主色调: `hsl(var(--primary))` → 改为柔和的蓝色 `#3B82F6`
- 网格线: `hsl(var(--border))` → 改为 `#E5E7EB` (更浅)
- 背景: 保持白色，但卡片边框改为 `#F3F4F6`

**3. 加载状态**:
```typescript
if (isLoading) {
  return (
    <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
      <Skeleton className="h-24" />
      <Skeleton className="h-24" />
      <Skeleton className="h-24" />
      <Skeleton className="h-24" />
    </div>
  );
}
```

---

### **Phase 1.4: "我的员工"页面重构** (P1)

#### 目标
让每张员工卡片"活"起来：
- 实时状态指示器（在线/离线）
- 能力标签视觉优化
- 卡片 hover 效果增强
- 骨架屏加载

#### 文件修改
- `/Users/yao/LLM/SEP/web/src/app/(enterprise)/my-employees/page.tsx`

#### 设计细节

**EmployeeCard 重新设计**:
```
┌────────────────────────────┐
│ 🤖 [绿点] 客服助手          │ ← 头像 + 状态灯 + 名称
│ 在线 · 2 小时前活跃         │ ← 状态文本
│ ─────────────────────────  │
│ #客服 #智能问答 #工单处理   │ ← 能力标签（圆角徽章）
│ ─────────────────────────  │
│ [聊天] [详情] [...]        │ ← 操作按钮
└────────────────────────────┘
```

**关键改进**:
1. 状态灯: `<StatusDot status="online" />` + 状态文本
2. 能力标签: 从简单文本 → 圆角徽章 (`bg-primary/10 text-primary`)
3. Hover 效果: `hover:shadow-lg hover:scale-[1.02]`
4. 实时更新: WebSocket 推送状态变化

---

### **Phase 1.5: 任务中心增强** (P1)

#### 目标
让任务执行可视化：
- 实时状态更新（WebSocket）
- 执行链路展示（TracePanel）
- 日志流式展示

#### 文件修改
- `/Users/yao/LLM/SEP/web/src/app/(enterprise)/tasks/page.tsx`
- 新建 `/Users/yao/LLM/SEP/web/src/components/task/trace-panel.tsx`

#### 设计细节

**TracePanel 组件**:
```
任务执行链路
├─ ✓ 接收用户消息 (100ms)
├─ ⟳ 调用能力: 客服知识库 (执行中...)
│  ├─ ✓ 向量检索 (50ms)
│  └─ ⟳ 生成回复... (进行中)
└─ ⏳ 等待完成
```

**实时更新机制**:
- WebSocket 推送任务状态变化
- 每个步骤完成后更新 UI
- 失败步骤用红色 ✗ 标记

---

## 🚀 执行顺序

### Week 1 - 基础设施
- [ ] Day 1: StatusDot + Skeleton + EmptyState 组件
- [ ] Day 2: MetricCard 组件
- [ ] Day 3: WebSocket 基础设施

### Week 2 - 核心页面
- [ ] Day 4: 侧边栏重构
- [ ] Day 5: Dashboard 重构
- [ ] Day 6: "我的员工"页面重构

### Week 3 - 增强功能
- [ ] Day 7: 任务中心 TracePanel
- [ ] Day 8: 实时状态集成
- [ ] Day 9: 细节打磨 + Bug 修复

---

## 📏 验收标准

### 视觉标准
- [ ] 老板打开 Dashboard，能立刻看到趋势指示器（↑ 20%）
- [ ] 侧边栏右上角有 WebSocket 连接状态灯（绿色 = 已连接）
- [ ] "我的员工"卡片有实时状态灯（绿色 = 在线）
- [ ] 所有加载状态都有骨架屏（不再是单调的 Spinner）
- [ ] 图表配色柔和（Dify 风格）

### 交互标准
- [ ] 卡片 hover 有明显反馈（阴影 + 缩放）
- [ ] 按钮点击有 active 状态（scale-[0.98]）
- [ ] 实时状态变化有平滑动画（不突兀）

### 性能标准
- [ ] Dashboard 加载 < 1s
- [ ] WebSocket 重连自动且透明
- [ ] 骨架屏消失后无闪烁

---

## 🎨 设计系统强化

### 颜色使用规范
```css
/* 主色调 - 柔和蓝 */
--primary: 217 91% 60%;        /* #3B82F6 */
--primary-foreground: 0 0% 100%;

/* 状态色 */
--success: 142 71% 45%;        /* 绿色 - 在线/成功 */
--warning: 38 92% 50%;         /* 黄色 - 忙碌/警告 */
--destructive: 0 84% 60%;      /* 红色 - 离线/错误 */

/* 中性色 - 更细腻的层次 */
--neutral-50: #F9FAFB;
--neutral-100: #F3F4F6;
--neutral-200: #E5E7EB;
--neutral-500: #6B7280;
--neutral-900: #111827;
```

### 阴影系统
```css
/* 卡片阴影 - 更柔和 */
.shadow-card {
  box-shadow: 0 1px 3px rgba(0, 0, 0, 0.06);
}

.shadow-card-hover {
  box-shadow: 0 4px 12px rgba(0, 0, 0, 0.08);
}

/* Modal 阴影 */
.shadow-modal {
  box-shadow: 0 8px 32px rgba(0, 0, 0, 0.12);
}
```

### 动画配置
```typescript
// 实时状态呼吸动画
const pulseAnimation = {
  animate: {
    scale: [1, 1.2, 1],
    opacity: [1, 0.8, 1],
  },
  transition: {
    duration: 2,
    repeat: Infinity,
    ease: "easeInOut",
  },
};
```

---

## 🔧 技术债务清理

### 已识别的技术债
1. ❌ `my-employees/page.tsx` 有嵌套 `<a>` 标签问题（已修复，但代码质量待提升）
2. ❌ Dashboard 图表数据是 mock 的（需要连接真实 API）
3. ❌ 没有错误边界（Error Boundary）
4. ❌ 没有全局错误处理（Toast 通知）

### 清理计划
- [ ] 重构 EmployeeCard 组件（移除 div onClick hack）
- [ ] 添加全局 Error Boundary
- [ ] 统一错误处理（API 层 + UI 层）

---

## 📖 参考资料

- 设计文档: `/Users/yao/LLM/SEP/docs/plans/UIUX-frontend-v1.md`
- Dify 官网: https://dify.ai (参考视觉风格)
- Shadcn/ui 文档: https://ui.shadcn.com
- Tailwind CSS 文档: https://tailwindcss.com

---

**下一步**: 立即开始 Phase 1.1 - 创建基础组件
