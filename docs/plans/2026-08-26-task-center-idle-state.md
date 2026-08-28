# Task Center Idle State Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** 将任务中心的空状态改造成一个轻量、拟人化的“硅基员工待命台”，让用户一进入页面就能理解任务入口、看到员工在线状态，并在输入、规划和计划生成之间获得连续反馈。

**Architecture:** 保留现有 `TasksPage` 的任务生命周期和已生成计划后的 `TaskFlowCanvas`，只重构 `plan === null` 时的 `TaskObjectiveComposer`。页面把企业员工列表作为展示数据传入 composer，由 composer 根据输入和规划状态渲染员工头像、状态气泡、唯一主输入、三个示例任务和在线摘要；计划生成成功后仍由父页面切换到自由编排画布。

**Tech Stack:** Next.js 15 App Router, React, TypeScript, Tailwind CSS, `lucide-react`, 现有 `Avatar`/`Button` 组件和浏览器 `prefers-reduced-motion` 媒体查询。不增加第三方依赖。

---

### Task 1: 明确空状态数据边界

**Files:**
- Modify: `web/src/app/(enterprise)/tasks/page.tsx`
- Modify: `web/src/features/task/task-objective-composer.tsx`

**Step 1:** 为 composer 定义最小员工展示类型，包含 `id`、`name`、`avatar`，并让父页面从 `availableEmployees` 传入最多 4 位员工和总数量。

**Step 2:** 保持 `objective`、`planning`、`error`、`onObjectiveChange`、`onGenerate` 现有契约，确保计划态与执行态不受影响。

**Step 3:** 对无员工、员工头像为空、员工名称为空等情况提供稳定的 initials/占位展示。

**Step 4:** 运行 `pnpm --filter web exec tsc --noEmit`，确认入参变更无类型回归。

### Task 2: 重构待命台视觉层级

**Files:**
- Modify: `web/src/features/task/task-objective-composer.tsx`

**Step 1:** 删除“新建任务”标签和宽大的说明性文案，仅保留中央任务输入区作为首要操作。

**Step 2:** 在输入框上方加入紧凑的员工待命区：头像叠放、在线状态点、状态气泡和当前可调用员工数量。

**Step 3:** 将 textarea、字符数和主按钮组合成一个响应式输入面板；桌面端输入区居中且宽度受控，移动端保持单列，首屏不产生滚动。

**Step 4:** 在输入框下方加入三个轻量示例任务按钮（调研竞品、整理会议纪要、生成产品方案），点击只填充文本，不自动提交。

**Step 5:** 底部仅保留“X 位员工在线”的低权重状态摘要，避免卡片堆叠和仪表盘化布局。

### Task 3: 添加拟人化状态与微动画

**Files:**
- Modify: `web/src/features/task/task-objective-composer.tsx`

**Step 1:** 根据 `objective.trim()` 和 `planning` 计算 `idle`、`typing`、`planning` 三种展示状态。

**Step 2:** 为每种状态提供短状态文案：待命时表示已准备好，输入时表示正在理解描述，规划时表示正在选择合适员工；规划中按钮显示 loading 和“正在规划”。

**Step 3:** 使用 CSS class 实现头像轻微呼吸、状态点闪烁/脉冲、focus ring 和规划中的进度感；动画只服务于状态表达，不添加粒子或大型插画。

**Step 4:** 增加 `@media (prefers-reduced-motion: reduce)` 覆盖，关闭持续动画并保留静态状态色彩和可读文案。

### Task 4: 错误、禁用与可用性状态

**Files:**
- Modify: `web/src/features/task/task-objective-composer.tsx`

**Step 1:** 保留现有错误提示，但改成输入区下方紧凑的可重试反馈，不改变父页面的 planner reset 行为。

**Step 2:** 输入不足 8 个字符时禁用提交并给出非侵入式的最小提示；规划中禁用 textarea、示例按钮和提交按钮，避免重复请求。

**Step 3:** 保证 textarea 有明确 `aria-label`，示例按钮可键盘操作，状态气泡使用 `aria-live="polite"`，主按钮保持可见焦点样式。

### Task 5: 回归验证与视觉验收

**Files:**
- Test/Verify: `web/src/features/task/task-flow.spec.ts`
- Verify: `web/src/features/task/task-objective-composer.tsx`
- Verify: `web/src/app/(enterprise)/tasks/page.tsx`

**Step 1:** 运行任务编排单测：`pnpm --filter web exec vitest run src/features/task/task-flow.spec.ts`。

**Step 2:** 运行类型检查：`pnpm --filter web exec tsc --noEmit`。

**Step 3:** 运行生产构建：`pnpm --filter web build`。

**Step 4:** 执行 `git diff --check`，确保没有空白错误。

**Step 5:** 在前端 `3000`、后端 `3001` 可用时，用 Playwright 打开 `http://localhost:3000/tasks`，验证空状态首屏无滚动、输入居中、员工状态可见、示例任务可点击、输入/规划文案变化；再验证生成计划后继续进入原有流程画布。

**验收标准:**

- 进入无计划任务中心时，第一视觉焦点是居中的任务输入框，页面不需要滚动才能完成首次输入。
- 用户能在首屏看到真实员工头像（或稳定 initials 占位）、在线数量和待命文案，但这些信息不压过主输入。
- 示例任务、错误重试、禁用态和键盘焦点均可用。
- 输入、规划状态存在明确且轻量的动态反馈，并尊重 reduced-motion 偏好。
- `plan !== null` 后原有流程画布、员工节点编辑、执行/停止/重试行为保持不变。
