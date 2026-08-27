# 能力贡献中心 UI/UX 重构方案

- 日期：2026-08-27
- 范围：**纯前端**。不改动任何后端接口、Prisma schema、DTO。所有信息均从现有
  `/contributions/*` 响应字段派生。
- 涉及路由：`web/src/app/(contribution)` → `ContributionDashboard` / `ContributionDetail`

## 1. 目标

把这个模块从「资产列表管理」纠正为它真实的形态：**审批流追踪器**。

用户在这个页面只关心三件事：

1. 我提交的能力现在走到哪一步了？
2. 卡在谁手上——是轮到我，还是在等别人？
3. 如果轮到我，我该点什么？

现有实现在这三件事上都没有给出答案，且存在一处数据自相矛盾（见 2.2）。

## 2. 现状诊断

### 2.1 没有卡片，只有横线

`contribution-dashboard.tsx` 自上而下 8 条平行分隔线：header `border-b` → 指标条
`border-b` → 标题行 `border-b` → 筛选行 `border-y` → 表格 `border-y` → 每行
`border-t`。所有内容权重相同，无分组，视觉上是一张表格纸。

圆角混用且未使用设计系统：`rounded-sm`（筛选按钮）、`rounded-md`（类型图标）、
无圆角（指标格 / 筛选容器 / 进度条 / 表格）。`tailwind.config.ts` 提供的
`glass-sm|md|lg|xl|pill` 圆角阶与 `shadow-glass-*` 阴影阶在这两个文件中零使用。

### 2.2 进度百分比是硬编码常量，且两处不一致（Bug）

`contribution-dashboard.tsx:138`

```ts
const progress = state.tone === 'success' ? 100 : state.tone === 'warning' ? 54 : state.tone === 'danger' ? 34 : 16;
```

`54` 与真实流程节点无关。而 `contribution-detail.tsx:173` 的 `pipelineProgress()`
按节点计数得出 `67`。**同一个能力：列表显示 54%，详情显示 67%。**

### 2.3 线性流程用网格表达

`Pipeline`（`contribution-detail.tsx:143`）用 `md:grid-cols-2 2xl:grid-cols-3` 铺 6 张
卡片，阅读顺序呈 Z 字跳跃，而发布流程是单链。节点连接线
`absolute -right-2 top-7 h-px w-2` 仅在 `2xl` 断点显示、宽 2px，实际不可见。

### 2.4 缺失「轮到谁」这一核心信息

`ActionBar`（`contribution-detail.tsx:115`）渲染在 header 右上角，而「当前卡在哪一步」
在页面下方——**待办动作与阻塞位置在视觉上完全分离**。且界面任何位置都没有区分
「轮到你」与「在等别人」。

### 2.5 拟人化是装饰而非信息

`WorkerStrip`（`contribution-detail.tsx:154`）硬编码两个虚构角色（`Skill 审核员` /
`Agent 接入员`）与两句写死的 desc，与真实流程状态无关。而真实经办人数据均已存在：
`contributor`、`enterpriseReviewedById`、`platformSubmittedById`。

### 2.6 死代码约 60 行

已定义但从未被引用：

| 文件 | 组件 |
|---|---|
| `contribution-dashboard.tsx` | `CapabilityRow`、`EmptyWorkspace` |
| `contribution-detail.tsx` | `ContextPanel`、`InfoRow`、`Layers3Icon` |

### 2.7 原生 `window.prompt` 收集驳回原因

`contribution-detail.tsx:66` 使用 `window.prompt('请输入驳回原因')`，与玻璃质感体系
割裂，且无法校验、无法取消区分。

### 2.8 表格列信息密度低

5 列中 `归属` 在个人贡献场景恒为「个人贡献」，`版本` 恒为 `v1`
（`_count.skillVersions`），二者合计占用约 250px。

### 2.9 指标条半数为零值

4 格指标中「发布处理中 0」「市场可见 0」在典型早期状态下均为 0，占据半条宽度而不
传递信息。

## 3. 已确认的设计决策

| # | 决策 | 结论 |
|---|---|---|
| ① | 进度语义 | **去掉百分比**，改为 `第 N / 共 M 步 · 步骤名`。列表与详情共用同一模型，消除 2.2 的矛盾 |
| ② | 视图形态 | **焦点列表为默认** + 右上角可切换到**阶段轨道看板**，两者共用同一张卡片组件 |
| ③ | 拟人化程度 | 克制。系统步骤用中性图标 + 「系统自动完成」，拟人化配额保留给真实的人（贡献者 / 企业管理员 / 平台运营） |
| ④ | 色彩 | 流程状态改用**低饱和语义色**；品牌色仅保留给主 CTA、当前步骤强调、eyebrow |
| ⑤ | 指标条 | 改为**一句话态势** + 仅呈现有值指标 |
| ⑥ | 清理 | 删除 2.6 的死代码；`window.prompt` 替换为项目 dialog |

## 4. 核心抽象：唯一流程真相

新增 `features/contribution/pipeline-model.ts`。**列表行的迷你轨道与详情页的时间轴必须
调用同一个 `buildPipeline()`**，这是修复 2.2 的结构性手段——不是把两个魔法数字调成一样，
而是让它们不可能不一样。

```ts
export type StageKey = 'draft' | 'validate' | 'enterprise' | 'authorize' | 'platform' | 'market';
export type StageState = 'done' | 'active' | 'waiting' | 'blocked';
export type ActorKind = 'contributor' | 'enterprise-admin' | 'platform-ops' | 'system' | 'market';

export interface PipelineStage {
  key: StageKey;
  title: string;          // 「企业管理员审核」
  state: StageState;
  actor: { kind: ActorKind; label: string };   // 经办人（③ 拟人化）
  fact: string;           // 一句话事实：「企业管理员已通过」
  at: string | null;      // 事件时间戳
  waitingDays: number | null;  // active 时的等待天数
  rejection: string | null;    // blocked 时的驳回原因
  cta: StageCta | null;   // 仅当轮到当前用户时非空
}

export interface StageCta {
  action: 'submit-enterprise' | 'approve' | 'reject' | 'request-platform' | 'authorize-platform';
  label: string;
  tone: 'primary' | 'secondary' | 'danger';
}

export interface PipelineModel {
  stages: PipelineStage[];
  currentIndex: number;   // 0-based，指向第一个非 done 节点
  total: number;          // 企业路径 6 / 个人路径 4
  current: PipelineStage;
  ballInCourt: boolean;   // 当前节点是否等待当前用户操作
}

export function buildPipeline(
  item: ContributionCapability,
  ctx: { hasEnterprise: boolean; isContributor: boolean; isEnterpriseAdmin: boolean },
): PipelineModel;
```

**入参只依赖 `ContributionCapability`（基础类型）**，不依赖
`ContributionCapabilityDetail`。基础类型已包含全部所需字段：`createdAt`、
`validatedAt`、`enterpriseReviewStatus`、`enterpriseReviewedAt`、
`enterpriseRejectionReason`、`platformReviewStatus`、`platformSubmittedAt`、
`platformRejectionReason`、`contributor`、`enterprise`。因此列表页无需额外请求。

### 4.1 节点推导表（企业路径，6 步）

| # | key | title | actor | state 推导 | 时间戳 |
|---|---|---|---|---|---|
| 1 | `draft` | 创建能力草稿 | 贡献者姓名 | 恒 `done` | `createdAt` |
| 2 | `validate` | 自动校验 | 系统 | `validatedAt` ? `done` : `active` | `validatedAt` |
| 3 | `enterprise` | 企业管理员审核 | 企业管理员 | `APPROVED`→done · `PENDING`→active · `REJECTED`→blocked · `NOT_SUBMITTED`→waiting | `enterpriseReviewedAt` |
| 4 | `authorize` | 授权公开投稿 | 企业管理员 | `REQUESTED`→active · `PENDING_REVIEW`\|`APPROVED`→done · 其他→waiting | `platformSubmittedAt` |
| 5 | `platform` | 平台运营审核 | 平台运营 | `APPROVED`→done · `PENDING_REVIEW`→active · `REJECTED`→blocked · 其他→waiting | `platformSubmittedAt` |
| 6 | `market` | 上架硅基人才市场 | 市场 | `APPROVED`→done · 其他→waiting | — |

个人路径（4 步）取 `draft`（措辞为「创建个人草稿」）、`validate`、`platform`、`market`。

### 4.2 CTA 归属（ball-in-court）

`cta` 仅在**轮到当前用户**时非空，从而把 `ActionBar` 的按钮下沉到对应节点上：

| 节点状态 | 条件 | CTA |
|---|---|---|
| `enterprise` waiting | `isContributor` | 提交企业审核（primary） |
| `enterprise` active | `isEnterpriseAdmin` | 企业通过（primary）+ 驳回（danger） |
| `enterprise` blocked | `isContributor` | 修改后重新提交（primary） |
| `authorize` waiting | `isContributor` 且企业审核已通过 | 申请公开投稿（secondary） |
| `authorize` active | `isEnterpriseAdmin` | 授权平台审核（primary） |
| `platform` waiting | `isContributor` 且无企业（个人路径） | 提交平台审核（primary） |
| `platform` blocked | `isContributor` | 修改后重新提交（primary） |

`validate` 处于 `active` 时**不产生 CTA**——那是系统在跑，不是用户的球。

三态呈现规则：

- **轮到你**：品牌色描边 + CTA 直接贴在节点内
- **等别人**：中性灰 + 「{经办人} 处理中 · 已等 N 天」
- **被驳回**：低饱和红 + 驳回原因内嵌展开 + 重新提交 CTA

## 5. 视觉规范（决策 ④）

### 5.1 表面与圆角

统一使用设计系统已有的 glass 阶，不再出现 `rounded-sm` / `rounded-md` / 无圆角混排：

| 用途 | 类 |
|---|---|
| 内容卡片 | `rounded-glass-lg border border-glassline bg-glass-1 shadow-glass-sm` |
| 卡片 hover | `border-glassline-hover bg-glass-2 shadow-glass-md -translate-y-px` |
| 小控件（输入框 / 分段按钮容器） | `rounded-glass-md` |
| 筛选胶囊 / 状态徽章 | `rounded-glass-pill` |
| 当前步骤强调 | `border-glassline-brand shadow-glow-brand` |

分隔线只在**卡片内部**分区时使用；页面级分组一律靠卡片与留白，取代 2.1 的横线堆叠。

### 5.2 低饱和语义色

`contribution-status.ts` 的 `toneClasses` 从 `/15` 填充降到 `/10`，并新增流程专用的
`stageToneClasses`：

```ts
export const stageToneClasses: Record<StageState, string> = {
  done:    'border-gsuccess/25 bg-gsuccess/8 text-gsuccess',
  active:  'border-glassline-brand bg-gbrand/10 text-gbrand-text',
  waiting: 'border-glassline bg-glass-1 text-gtext-muted',
  blocked: 'border-gdanger/25 bg-gdanger/8 text-gdanger',
};
```

品牌色（`gbrand`）**只允许**出现在：主 CTA 按钮、当前步骤指示、eyebrow 标签、
类型图标（Skill）。禁止用于大面积进度条填充——移除现有那条实心 `bg-gbrand` 横条。

### 5.3 动效

- 统一 `transition-all duration-200 ease-out`
- 卡片 hover：`-translate-y-px` + 阴影升一阶
- 当前步骤：`animate-pulse-slow` 呼吸环（复用 tailwind 已有 keyframe）
- 不引入新依赖（不加 framer-motion）

## 6. 文件清单

```
web/src/features/contribution/
├── pipeline-model.ts                  新增  唯一流程真相（§4）
├── contribution-status.ts             修改  低饱和 tone + actor 元数据
├── components/
│   ├── pipeline-mini-track.tsx        新增  列表用 N 点轨道
│   ├── pipeline-timeline.tsx          新增  详情用竖向时间轴
│   ├── stage-actor-badge.tsx          新增  经办人徽章（③）
│   ├── contribution-asset-card.tsx    新增  焦点列表卡片（视图 B）
│   ├── contribution-lane-board.tsx    新增  阶段轨道看板（视图 A）
│   ├── overview-summary-bar.tsx       新增  一句话态势（⑤）
│   └── reject-reason-dialog.tsx       新增  替换 window.prompt（⑥）
├── contribution-dashboard.tsx         重构  总览页
└── contribution-detail.tsx            重构  详情页
```

单文件控制在 200–400 行（遵循项目 coding-style：many small files）。

## 7. 总览页设计

### 7.1 结构

```
┌ Header ──────────────────────────────────────────────────────┐
│ CAPABILITY OPERATIONS                                        │
│ 能力贡献中心  把可复用的工作方法，发布为组织资产  [+ 创建能力] │
├ 态势条（⑤）─────────────────────────────────────────────────┤
│ 1 项能力资产 · 1 项正在平台审核 · 10 积分待结算              │
│ ⤷ 有待你处理的节点时，这里追加一条高亮行 + 直达按钮           │
├ 工具栏（卡片内）─────────────────────────────────────────────┤
│ [🔍 搜索…]        [全部 Skill Agent RPA AI App]  [状态 ▾] [▤▦]│
├ 内容 ────────────────────────────────────────────────────────┤
│ 焦点列表（默认）或 阶段轨道看板                               │
└──────────────────────────────────────────────────────────────┘
```

态势条不再是 4 个等宽格子。零值指标直接不渲染；当存在 `ballInCourt` 的能力时，追加一
条「N 项能力等待你处理」并提供跳转，这是全页最高优先级的信息。

### 7.2 焦点列表卡片（视图 B，默认）

```
┌────────────────────────────────────────────────────────────────────┐
│ ✦  研发周报洞察 Skill  [Skill]                ●─●─●─●─◉─○          │
│    把研发团队的周报、工单和发布记录整理成…    草稿 校验 企业 授权 平台 上架 │
│    软件研发 · 研发管理 · v1                                        │
│                                    第 5/6 步 · 平台运营 已等 2 天  │
│                                                      [ 查看进展 → ]│
└────────────────────────────────────────────────────────────────────┘
```

- 迷你轨道 = `PipelineMiniTrack`，点数 = `model.total`，实心=done、光环=active、
  空心=waiting、叉=blocked。**取代硬编码的百分比进度条。**
- 右下角一行给出 `第 N/M 步 · {经办人} {等待时长}`，即决策 ①。
- 若 `ballInCourt`，卡片改用品牌色描边，并把该节点的主 CTA 直接渲染在卡片右下角。
- 移除低信息量的 `归属`、`版本` 独立列（2.8），版本并入元信息行。

### 7.3 阶段轨道看板（视图 A，可切换）

按 `StageKey` 横向分列（企业路径 6 列 / 个人路径 4 列），列头显示阶段名与计数，能力卡
片以紧凑形态落入所处阶段列。空列保留列头但显示占位文案，避免视图塌陷。

视图选择持久化到 `localStorage`（key: `sep.contribution.view`），不引入后端偏好存储。

## 8. 详情页设计

### 8.1 Header

保留返回、类型徽章、状态徽章、标题、描述。**移除右上角 `ActionBar`**——按钮全部下沉
到时间轴对应节点（§4.2）。header 右侧改为放当前进度摘要：`第 5/6 步 · 平台运营审核`。

Tab 结构不变（发布流程 / 版本迭代 / 使用情况 / 能力档案 / 贡献奖励），仅调整为统一圆角
与低饱和选中态。

### 8.2 发布流程：网格 → 单列时间轴

替换 `Pipeline` 的 `grid-cols-2/3`（2.3）为 `PipelineTimeline`：

```
 ┃
 ● 创建能力草稿                                        2026/8/25 14:41
 ┃ 甲总 起草了这项能力 · 归属 示例科技有限公司
 ┃
 ● 自动校验                                            2026/8/25 17:04
 ┃ 系统已校验输入输出结构与安全边界
 ┃
 ● 企业管理员审核                                      2026/8/25 15:59
 ┃ 企业管理员 已通过
 ┃
 ● 授权公开投稿                                        2026/8/25 17:05
 ┃ 企业管理员 已授权提交平台审核
 ┃
 ◉ 平台运营审核                                    进行中 · 已等 2 天  ← 焦点卡
 ┃ 平台运营 正在评估这项能力
 ┃ （轮到当前用户时，CTA 按钮渲染在此处）
 ┋
 ○ 上架硅基人才市场                                            未开始
   通过后所有企业可以雇佣
```

- 左侧一条连续轨道：done 段实色、active 段品牌色 + 呼吸环、waiting 段虚线。
- 每个节点一行事实句，主语是**真实经办人**（决策 ③）。系统步骤主语为「系统」并配中性
  图标，不虚构角色名。
- `active` 节点渲染为焦点卡（`bg-glass-2` + 品牌描边），承载 CTA。
- `blocked` 节点内嵌 `rejection` 原因，无需用户另寻位置查看。
- **删除 `WorkerStrip`**（2.5）——它的信息已由每个节点的经办人承载。

### 8.3 驳回原因对话框（⑥）

`reject-reason-dialog.tsx` 复用项目 `Dialog` + `Textarea`：

- 必填校验（trim 后非空），空值时禁用提交按钮而非提交后报错
- 取消与提交状态明确区分（现有 `window.prompt` 无法区分「取消」与「输入空串」）
- 提交中 `loading` 态复用 `Button` 的 `loading` prop

## 9. 实施阶段

| 阶段 | 内容 | 产出 |
|---|---|---|
| P1 | `pipeline-model.ts` + `contribution-status.ts` 扩展 + `reject-reason-dialog.tsx` | 流程模型可被两端调用 |
| P2 | 总览页：态势条、工具栏、`contribution-asset-card`、`pipeline-mini-track`、视图切换 + `contribution-lane-board` | 视图 A/B 均可用 |
| P3 | 详情页：`pipeline-timeline` + CTA 下沉，删除 `ActionBar` / `WorkerStrip` | 时间轴与球权呈现 |
| P4 | 清理 2.6 死代码，`tsc` + `next build` 验证，Playwright 截图复核 | 无回归 |

## 10. 验收标准

1. 列表与详情对同一能力显示**完全一致**的步数（`第 N/M 步`），不存在百分比。
2. 页面不再出现硬编码的 `54` / `34` / `16` / `67` 等进度魔法数字。
3. `grep -n "window.prompt" web/src/features/contribution/` 无结果。
4. 2.6 表格所列 5 个组件全部删除，`tsc --noEmit` 无 unused 报错。
5. 存在待当前用户处理的节点时，主 CTA 与该节点在**同一视觉容器内**。
6. `rounded-sm` / `rounded-md` 在这两个文件中不再出现（统一 glass 圆角阶）。
7. `bg-gbrand` 不再用于进度条填充。
8. 深浅两套主题（`:root` / `.theme-glass`）下对比度均达 AA。

## 11. 不做的事

- 不改后端：不新增字段、不改 DTO、不动 `/contributions/*` 响应结构。
  经办人姓名在后端仅提供 id（`enterpriseReviewedById` / `platformSubmittedById`）的节点，
  前端以角色名（「企业管理员」「平台运营」）呈现，不为拿姓名而扩接口。
- 不引入动画库（framer-motion 等），动效用 tailwind 已有 keyframes。
- 不改创建向导（`contribution-create-dialog.tsx`）的三步结构——它是本模块目前设计质量
  最高的部分，仅随 §5.1 统一圆角与阴影。
- 不动 `use-contributions.ts` 的查询/变更钩子签名。

## 12. 实施记录（2026-08-27 完成）

§9 的四个阶段已全部落地，`tsc` / `next build` / 191 个单测全绿。相对本方案的偏差与增补：

### 12.1 计划外的增补

| 项 | 原因 |
|---|---|
| `pipeline-model.test.ts`（13 个用例） | 流程模型是本次唯一含真实逻辑的模块，且它同时驱动两个页面，需要用测试锁住节点推导与球权归属 |
| `components/ui/button.tsx` 新增 `glass-danger` variant | 驳回按钮需要玻璃面上的破坏性样式；实心 `danger` 会和主 CTA 抢权重。属设计系统内的新增，不改动既有 variant |
| `pipeline-model.ts` 新增 `boardLane()` | 见 12.2 |

### 12.2 实施中发现并修正的设计缺陷

以下四点在写代码与看截图时才暴露，均已修正：

1. **轨道看板的列归属不能用 `current.key`。** `draft` 节点恒为 `done`，`currentIndex`
   永远不会指向它，导致「已校验但还没提交审核」的能力被放进「企业审核中」列，看起来
   像已经提交过。新增 `boardLane()` 把这类情况归回草稿列。
2. **被驳回时球权信号会丢失。** `pipelineWaitLabel()` 原先对 `blocked` 一律返回
   「{经办人} 已驳回」，即使该驳回正等着本人修改。改为在 `ballInCourt` 时返回
   「已驳回 · 待你修改」。
3. **`waiting` 状态的当前节点缺少视觉区分。** 迷你轨道里它和后面几个未开始的点完全
   相同；时间轴里它也没有焦点卡。现在当前 `waiting` 节点的点带品牌色描环，且
   `focused` 判定纳入「持有 CTA」——球在用户手里的那一步一定是焦点卡。
4. **未开始的节点不应显示时间戳。** 后端残留的旧 `enterpriseReviewedAt` 会让
   「未开始」的节点显示出一个过去时间，读起来像已经发生过。`waiting` 状态不渲染时间。

### 12.3 轨道看板的宽度

首版用固定 `w-[240px]`，6 条轨道在 1440 视口下溢出，**恰好把唯一有数据的那一列裁掉**。
改为 `flex-1 min-w-[168px]`：常规桌面宽度一屏放下，窄屏收缩到 `min-w` 后才横向滚动。

### 12.4 可访问性

初版用 `text-gtext-muted/70`、`/50` 这类透明度稀释来做次级文字层级，小字号下会跌破
AA。已全部改回令牌自身的色阶（`gtext-muted` / `gtext-secondary`），层级靠字重和
颜色档位区分，不靠透明度。`grep "gtext-muted/"` 在本模块下为空。

### 12.5 已知的既有问题（未在本次范围内修）

`ContributionDetail` 直接解引用 `contribution.contributor.id`，若接口返回体缺字段会
运行时崩溃。这是重构前既有的假设（原 `contribution-detail.tsx:54` 同样如此），不是本次
引入的回归，故未改动。如需加固应作为独立改动处理。

### 12.6 视觉验证

`output/playwright/` 下的截图（Playwright，1440×900，boss@acme.local）：

| 文件 | 内容 | 数据来源 |
|---|---|---|
| `contribution-redesign-list.png` | 焦点列表 | 真实数据 |
| `contribution-redesign-board.png` | 轨道看板 6 列 | 真实数据 |
| `contribution-redesign-detail.png` | 时间轴（平台审核中） | 真实数据 |
| `contribution-redesign-dark.png` / `-dark-detail.png` | 深色主题 | 真实数据 |
| `contribution-redesign-states-list.png` | 四种球权状态并列 | **拦截响应构造，未写库** |
| `contribution-redesign-ballincourt.png` | 待提交 + 节点内 CTA | **拦截响应构造，未写库** |
| `contribution-redesign-rejected.png` | 驳回原因内嵌 + 重新提交 | **拦截响应构造，未写库** |

后三张用 Playwright 的 `page.route` 改写读接口来构造状态，**没有创建或修改任何数据**，
Boss 演示数据保持原样。

