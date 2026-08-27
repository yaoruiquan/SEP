# 任务中心 UI/UX 重构方案

- 日期：2026-08-27
- 范围：`web/` 前端重构 + 接入新的任务持久化 API
- 后端持久化由并行的另一个 agent（codex）按
  [API 契约](./2026-08-27-task-center-api-contract.md) 实现，本文档不重复契约内容
- 前置：能力中心刚统一到 glass 令牌体系
  （见 [能力贡献中心重构](./2026-08-27-capability-contribution-uiux-redesign.md)）

## 1. 核心判断

**这个页面的主角是员工，不是节点图。**

重构前的实现把「谁在干活」降级成了图元属性：节点卡片以 `01 会议纪要整理 ○候场中` 为主体，
员工名缩到 11px 副行、头像 7×7。而产品的核心叙事是「雇硅基员工替你干活」——
执行阶段恰恰是最该拟人化的时刻：谁在干、干到哪、说了什么。

所以主线从「流程画布」换成「员工工作台」：一列纵向流，每一行是一个员工在汇报工作。
依赖图不删，降级成可切换的第二视图。

## 2. 现状诊断

### 2.1 深色主题是坏的，成因精确

`globals.css:1373` 的注释自己写明：令牌桥只覆盖语义 class，写死的字面色靠 SCOPED
OVERRIDES 兜。而那批 override 覆盖了 `neutral-*`（23 条）与 `bg-white`，
**`slate-*` 零条、`emerald-*` 零条**。

任务中心三个主文件里有 **207 处** `slate-/emerald-/blue-/rose-/amber-` 字面色，于是深色下：

| 元素 | 结果 |
|---|---|
| `bg-white` 卡片 | 翻黑了（被 `globals.css:1401` 兜住） |
| `text-slate-950` / `border-slate-200` | 没翻 → 黑字压黑底 |
| 「你的硅基团队已准备好」`bg-emerald-50 + text-emerald-700` | 深色页里一块**浅色孤岛** |

实测截图：`output/playwright/tasks-current-dark.png` —— header 的「任务记录」「模板」
按钮和「试试」三个胶囊几乎不可见。这不是审美问题，是不可用。

### 2.2 36% 的代码是死的（854 / 2388 行）

| 文件 | 行数 |
|---|---|
| `task-step-inspector.tsx` | 344 |
| `task-execution-panel.tsx` | 187 |
| `task-plan-preview.tsx` | 104 |
| `launch-task-dialog.tsx` | 99 |
| `task-skeleton.tsx` | 52 |
| `task-run-timeline.tsx` | 50 |
| `task-run-output.tsx` | 18 |

`task-step-inspector.tsx` 与 canvas 里内联的 `StepInspectorPanel`
（`task-flow-canvas.tsx:307`）功能重叠 —— 内联版取代了它但没删。

### 2.3 分层算法写好了、测过了，画布不用它

`task-flow.ts` 的 `buildTaskFlowStages()` 按 `dependsOn` 做拓扑分层，还配了 spec。
但画布实际用的是 `task-flow-canvas.tsx:439`：

```ts
{ x: 250 + (index % 3) * 245, y: 92 + Math.floor(index / 3) * 165 }
```

3 列固定网格，**和依赖关系完全无关** —— 所以连线斜穿画布，节点位置和逻辑顺序没关系。

### 2.4 自由画布的成本与用途不匹配

1 个员工节点占 1400×700 画布，中间大片点阵是空的。而代价是：手写 pointer 拖拽
（约 50 行 + 边界 clamp）、手写 SVG 贝塞尔连线（4 段 `flatMap` 字符串拼接，
`:489-492` 单行超长）、手写连接点 hit-test、**位置不持久化**（只在组件 state，刷新即丢）。

用户真正需要的编辑动作只有四个：加节点、删节点、调顺序、改依赖 —— 都不需要自由画布。

### 2.5 状态文案四个来源

`STATUS_LABELS`（`:34`）、`StepDetail` 内联三元链（`:251`）、`StepInspectorPanel`、
以及暂停态那个独立分支。同一个步骤在不同位置显示不同说法。

### 2.6 「交付产物」语义是错的

`openFinalOutput()`（`page.tsx:434`）取 `[...steps].reverse().find(s => s.output)`
——「最后一个有输出的步骤」。多步任务里最后一步失败时，它会拿倒数第二步的输出冒充交付物。

### 2.7 任务记录是浏览器本地的，UI 没说

`localStorage['sep-task-plans']` / `['sep-task-templates']`。后端只有
`POST /task-plans/preview`（生成计划，不落库），Prisma schema 里 `model Task` 数量为 0。
换浏览器/无痕/换设备/清缓存 → 全丢；执行中关标签页 → 步骤永久卡在 `running`。

header 上那个「本地工作区」其实是 WebSocket 连接状态（`page.tsx:486`），与数据存放位置
无关，反而更容易让人误解。

## 3. 已确认的设计决策

| # | 决策 | 结论 |
|---|---|---|
| ① | 死代码 | 删除确认无引用的；`task-step-inspector.tsx` / `task-flow-canvas.tsx` 暂留（见 §8.2） |
| ② | 主视图 | **员工工作台为默认** + 可切换依赖图，两者共用同一条目标栏 |
| ③ | 布局 | 自动分层做**初始位置**，手动拖拽仍可覆盖并**持久化**；「重新排列」回到自动布局 |
| ④ | 持久化 | **做后端**（不再是 localStorage），任务/模板/事件都落库 |
| ⑤ | 产物 | 正名为「运行结果」+ 步骤切换；不造汇总产物（单步输出本来就能看到） |

决策 ③ 的由来：纯自动分层不够灵活，所以采用「自动兜底 + 手动优先 + 一键还原」，
同时借 ④ 把位置真正存下来，修掉 2.4 里「拖过就丢」的缺陷。

## 4. 拟人化：让员工"说话"

不是加头像装饰，而是把状态改写成第一人称工作汇报。统一到 `task-step-state.ts`，
消掉 2.5 的四个来源。

| 状态 | 重构前 | 重构后 |
|---|---|---|
| queued（有上游） | `候场中` | `等 变革管理顾问 交付后开始` |
| queued（无上游） | `候场中` | `变革管理顾问 已就位，确认计划后开始` |
| running | `正在工作` | `变革管理顾问 正在会议纪要整理` + `已用 38 秒` |
| completed | `已完成` | `变革管理顾问 交付了结果` + `用了 1 分 12 秒` |
| completed（无文本） | `已完成` | `完成了这一步，没有返回文本` |
| failed | `需要处理` | 错误原文当汇报内容 + `从这一步重试` |
| paused | `已暂停` | `变革管理顾问 已停下，等你恢复` |

运行级同理：`第 2/3 步进行中 · 乙 正在会议纪要整理` / `第 3 步卡住了 · 接口超时` /
`已完成 3/3 步` / `已停止，可以从中断处继续`。

配套视觉：**工位灯** —— 员工头像右下角的状态点（`EmployeeBadge`），running 带呼吸光晕。
头像从 7×7 提到 lg（56px）作为每行主体。技能是**工牌**（`CapabilityTag`），
表示"员工带着哪张牌上工"。

一处去重：岗位常常和员工名一字不差（都叫「变革管理顾问」），此时不渲染岗位，
否则一行里同一个词出现三遍。

## 5. 文件清单

```
web/src/features/task/
├── task-step-state.ts               新增  状态文案与语气的唯一来源（§4）
├── task-step-state.spec.ts          新增  13 个用例
├── task-run.ts                      新增  服务端记录类型 + 孤儿判定 + 模板重置
├── use-task-runs.ts                 新增  TanStack Query hooks（替代 localStorage）
├── task-objective-composer.tsx      重写  glass 令牌 + ⌘↵ 提交
├── components/
│   ├── employee-badge.tsx           新增  工位灯头像 + 技能工牌 + tone 色表
│   ├── workbench-step-row.tsx       新增  员工工作汇报行
│   ├── task-workbench.tsx           新增  目标栏 + 纵向员工流（默认视图）
│   ├── task-dependency-graph.tsx    新增  自动分层依赖图（取代 task-flow-canvas）
│   ├── task-history-drawer.tsx      新增  任务记录 + 孤儿运行回收
│   ├── task-template-drawer.tsx     新增  模板抽屉
│   └── task-result-dialog.tsx       新增  运行结果 + 步骤切换（§3 ⑤）
└── (删除) task-execution-panel / launch-task-dialog / task-plan-preview /
          task-run-timeline / task-run-output / task-skeleton / task-list-rail

web/src/app/(enterprise)/tasks/page.tsx   重写  编排状态 + 执行循环 + 落库时机
web/src/lib/query-keys.ts                 追加  taskRuns / taskRun / taskRunEvents / taskTemplates
web/src/components/ui/button.tsx          （能力中心那轮已加的 glass-danger 沿用）
```

## 6. 落库时机

执行仍在浏览器里跑，只在**步骤边界**写库（流式 token 不写，太频繁）：

| 动作 | 请求 |
|---|---|
| 生成计划 | `POST /api/tasks` |
| 点确认执行 | `PATCH /api/tasks/:id` `{ status:'running', steps, startedAt }` |
| 每步开始/结束 | `PATCH /api/tasks/:id/steps/:stepId` |
| 运行结束 | `PATCH /api/tasks/:id` `{ status, completedAt }` |
| 改计划结构 | `PATCH /api/tasks/:id` `{ steps, status }` |
| 拖动节点 | `PATCH /api/tasks/:id` `{ layout }`，防抖 800ms |

步骤级 PATCH 只带**有值**的字段：DTO 是 `.strict()` 的，塞 `null` 会被 400 拒。
清除上一轮的 error 不靠它 —— `executePlan` 起步时整份 PATCH `steps`，
`clonePlanForExecution` 已把重跑范围内的 `error` 抹掉。

缓存写入用**合并而非覆盖**：步骤级 PATCH 的响应不保证带齐 `stepCount` /
`completedStepCount` / `employeeNames` 这些派生字段（实测确实没带），
直接 `setQueryData` 会把缓存里已有的值抹成 `undefined`。

## 7. 视图

### 7.1 员工工作台（默认）

```
┌ 目标栏 ─────────────────────────────────────────────────────────┐
│ 整理今天的会议纪要，提炼关键结论与待办事项        [ ▶ 确认并执行 ] │
│ 第 2/3 步进行中 · 变革管理顾问 正在会议纪要整理                    │
│ (头像堆叠) ▓▓▓▓▓░░ 1/3 步              [执行流] [依赖图]          │
├─────────────────────────────────────────────────────────────────┤
│ ◉  01 变革管理顾问  [会议纪要整理]        正在工作 · 已用 38 秒 🗑 │
│ ┃    变革管理顾问 正在会议纪要整理                                 │
│ ┃    ┌───────────────────────────────────────────────────┐      │
│ ┃    │ 实时输出流（跑完折叠成「查看交付内容」）            │      │
│ ┃    └───────────────────────────────────────────────────┘      │
│ ┊                                                                │
│ ○  02 数据分析师    [数据比对]            候场中 · 预计 20 分钟    │
│      等 变革管理顾问 交付后开始                                   │
│                                                                  │
│           [ + 再加一位员工 ]                                      │
└─────────────────────────────────────────────────────────────────┘
```

- 左侧轨道：done 实色、active 品牌色、waiting 虚线（与能力中心时间轴同一套语言）
- 运行中的行展开实时输出 + 工具调用胶囊 + 思考摘要；其余折叠
- 点开一行展开：这一步要做什么 / 上游依赖（可解绑）/ 换人做这一步 / 为什么派他
- 删除按钮收到行首右侧，hover 才出现，不再占一整行

### 7.2 依赖图（可切换）

`buildTaskFlowStages()` 按依赖深度分列，同层纵向排开 —— 连线永远是从左到右的短线，
修掉 2.3 的斜穿。端点（任务输入 / 交付出口）的纵向位置**对齐到它实际连的那些节点行**
的平均高度，而不是画布中线，否则连线会从画布中间往上斜甩，看着像没接上。

节点做成员工工位卡（工位灯 + 名字主位 + 技能工牌 + 状态），不是流程框。
拖拽仍可覆盖自动位置并落库；「重新排列」清空 layout 回到自动布局。

## 8. 实施结果

### 8.1 验证

- `tsc --noEmit` 通过；`next build` 编译成功；**207 个单测通过（13 个文件）**，其中新增
  `task-step-state.spec.ts` 13 例（文案分支、时长格式、依赖点名、自动分层的深度与乱序输入）
- 截图（1440×900，boss@acme.local，`output/playwright/`）：
  `tasks-new-composer` / `tasks-new-workbench` / `tasks-new-step-expanded` /
  `tasks-new-graph` / `tasks-new-history`，各含 `-dark` 版本
- 深浅两套主题实测可读，`tasks-current-dark.png` 是重构前的对照

### 8.2 暂留的两个文件

`task-step-inspector.tsx`（344 行）与 `task-flow-canvas.tsx`（502 行）现在都已无引用，
但它们带着**另一个会话的未提交改动**（合计 +232 行）。其功能已由
`workbench-step-row` / `task-dependency-graph` 承接，删除是安全的，但那会永久丢掉那些
未提交的编辑。**留待确认后再删。**

### 8.3 保留的既有功能

「功能不能缺少」的核对清单，全部在新版本里：模板存/载/删、单步暂停与恢复、
停止执行、失败步骤重试（从该步继续）、节点增删、依赖连线与解绑、员工替换、
任务记录、实时流式输出与工具调用、运行结果查看。

新增：跨设备可见、执行中断后可回收现场（孤儿运行）、画布位置持久化、事件流水。

### 8.4 并行开发中发现的契约缺陷

前后端并行时抓到一个会直接打断集成的问题，记录在此以备后续参照。

**`CapabilityType` 枚举大小写。** 后端首版把它写成小写
`z.enum(['agent','rpa','skill','ai-app'])`，而真实数据是大写：`web/src/lib/types.ts:3`
定义 `'AGENT' | 'RPA' | 'SKILL' | 'AI_APP'`，`POST /api/task-plans/preview` 实测返回
`'SKILL'`。后果是前端把 preview 生成的计划 POST 上去必定 400。

成因两边各一半：契约 §4.1 原文只写了「必须和 `CapabilityType` 对齐」而没列字面值；
而 `backend/src/shared/` 里能力上传那套 DTO 用的确实是小写，实现方照搬了。
修复后契约已补上显式字面值与「那是另一个接口的约定」的警告。

教训：**契约里凡是枚举，必须列出字面值，不能只给类型名** —— 同一个概念在这个代码库里
存在两种拼法时，类型名不足以消除歧义。

## 9. 已知限制

**关掉标签页任务不会继续跑。** 执行仍由浏览器驱动，后端只负责持久化。真要做到，
需要把执行搬到后端（队列 + SSE 推进度）并重做 chat 的流式链路 —— 那是独立一期，
本次刻意不做（见 API 契约 §9.10）。作为补偿，前端会把「running 且超过 10 分钟没动静」
的记录标为执行中断，并提供一键回收。
