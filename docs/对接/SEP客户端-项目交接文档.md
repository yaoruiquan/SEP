# SEP 客户端（sep-client）—— 独立项目交接文档

> 文档版本：v1.1 · 2026-07-29（v1.1 变更：壳技术选型由 Tauri 改为 **Electron**，
> 集成方式由「pi 二进制 sidecar + RPC」改为「主进程内直接用 `pi-coding-agent` SDK」；
> 影响 §0、§3、§5.3、§8.1、§8.4）
> 面向读者：接手客户端二次开发的工程师（可能不熟悉 SEP 平台）
> 关联文档：[方向调整设计方案 v3](../architecture/v3/硅基员工平台-方向调整设计方案-v3.md) ·
> [项目升级开发顺序方案 v3](../plans/项目升级开发顺序方案v3.md)

---

## 0. 一页读懂

**你要做什么**：基于开源项目 [`earendil-works/pi`](https://github.com/earendil-works/pi)
做二次开发，产出一个 **Electron 桌面客户端**。企业员工在这个客户端里
使用他们被授权的「硅基员工」。

**为什么是 pi**：pi 是 MIT 协议、模型无关、原生支持 `SKILL.md` 标准的
agent 运行时，且提供了完整的 SDK / RPC / Extension 扩展点 ——
不需要 fork 改内部源码就能定制。（历史上 ADR 曾选定 OpenCode，
pi 满足同样的硬约束，且在「模型调用经平台网关」这一关键点上
有官方扩展点 `registerProvider`，比改环境变量的方式干净。）

**这个客户端和 SEP 平台是什么关系**：

```
SEP 平台（本仓库）                          sep-client（你的项目）
= 分发与授权层                              = 执行层
├─ 卖什么（员工模板/市场）
├─ 谁能用（企业/部门/成员/授权）  ──────►  登录 → 拉取我被授权的员工
├─ 包在哪（员工包分发）           ──────►  下载并加载员工包
└─ 模型网关（计量与额度）         ◄──────  所有模型调用回到这里
```

**一句话技术架构**：Electron（主进程 Node.js + 进程内 `pi-coding-agent` SDK）+ 渲染进程
React + shadcn/ui（复用 SEP web 端组件风格）。凭据存储走 Electron `safeStorage`。

**五项已决策事项**（不要再翻案，除非有新信息）：

| # | 议题 | 决策 |
|---|---|---|
| 1 | GUI 技术选型 | **Electron**（主进程 Node.js，进程内调 `pi-coding-agent` SDK；RPC/sidecar 模式保留作降级备选）|
| 2 | 员工包清单格式 | **未定** —— 前期只做最简且必要的；见 §7 |
| 3 | 入网方式 | **账号登录**（不用激活码）|
| 4 | 本地权限强度 | **工具白名单 + GUI 弹窗批准**（不做容器化）|
| 5 | 员工包分发通道 | **复用 pi 自己的 package 机制**（不自建 ZIP + 下载令牌）|

---

## 1. 名词表

读代码和文档前先对齐术语，SEP 的命名有几处容易混。

| 术语 | 含义 | 代码中的对象 |
|---|---|---|
| **碳基员工** | 企业里的人类成员 | `EnterpriseMember` |
| **硅基员工** | AI 员工，本文档的主角 | 模板 `DigitalEmployee` / 实例 `EmployeeInstance` |
| **员工模板** | 市场上「卖」的那个东西，全平台共享 | `DigitalEmployee` |
| **员工实例** | 某企业订阅后生成的、带企业自有配置的那一份 | `EmployeeInstance` |
| **员工包** | 员工的可执行载体（本项目中 = 一个 pi package）| 待建 |
| **授权** | 某实例被授权给哪些部门/成员 | `EmployeeGrant` |
| **算力** | 平台内的计费单位，模型 token 折算而来 | `ComputeAccount` / `ComputeTransaction` |
| **壳 / 客户端** | 就是你要做的 sep-client | — |
| **pi** | 上游开源 agent 运行时 | — |

**关键区分**：模板 : 实例 = 1 : N。同一家企业可以从同一个模板订阅出
**多个**实例（比如市场部一个「视频工程师」、品牌部另一个），各自独立配置。
客户端必须按 **实例** 而不是按模板来组织界面。

---

## 2. pi 是什么：够用的最小理解

### 2.1 分层

pi 是 monorepo，四个包自下而上：

| 包 | 职责 | 你会怎么用它 |
|---|---|---|
| `@earendil-works/pi-ai` | 统一 LLM API，provider 抽象 | 注册 SEP 网关 provider |
| `@earendil-works/pi-agent-core` | Agent 状态机、工具执行循环、事件流。**完全无 UI** | 间接使用 |
| `@earendil-works/pi-coding-agent` | 会话持久化、skills 加载、extension 系统、内置工具、`ResourceLoader`、四种运行模式 | **主要工作面** |
| `@earendil-works/pi-tui` | 终端 UI | **不用**（我们做 GUI）|

「把 pi 变成 GUI 客户端」= 用 `pi-coding-agent` 的能力，
但不加载 `pi-tui`。pi 的交互式终端界面只是它四种运行模式之一，
不是它的本体。

### 2.2 四种运行模式

pi 自身支持：交互式 TUI / 单次执行（print）/ **RPC** / 服务端模式。
**我们用 RPC**：`pi --mode rpc`，stdin/stdout 上跑 JSONL，
每行一个 JSON 消息。

> ⚠️ **实现坑**：解析 JSONL 时按 `\n` 手工切分，
> **不要用 Node 的 `readline`** —— 它会在 Unicode 行分隔符
> （U+2028 等）上错误断行，而模型输出里出现这些字符是常态。
> pi 官方文档明确警示了这一点。

### 2.3 一个「硅基员工」在 pi 里是什么

这是整件事能轻量落地的关键洞察：**一个硅基员工 = 一组 session 构造参数**。
pi 的会话创建接口恰好开放了定义一个员工所需的全部旋钮：

| 员工的构成要素 | pi 的对应入口 |
|---|---|
| 人设 / 职责 | `ResourceLoader` 的 `systemPromptOverride` |
| 领域技能 | `skillsOverride`（可完全接管，只挂本员工的 skills）|
| 能用哪些工具 | `tools` 白名单 / `noTools` / `excludeTools` |
| 用哪个模型 | `modelRuntime` + `setModel` |
| 企业侧配置 | 注入为虚拟上下文文件（`agentsFilesOverride`）|
| 额外能力 | `extensionFactories`（内联扩展，不落盘）|

所以「切换员工」不是启动另一个程序，而是**用另一份授权数据构造一个
ResourceLoader**。这直接实现了 v3 决策 1 的「一个壳装多个员工」。

**必须做的动作：传自定义 `ResourceLoader`。**
pi 文档明确：一旦传了自定义 loader，`cwd` 和 `agentDir` 就不再控制
资源发现。这正是隔离所需 ——

- 不能让用户 `~/.pi/agent/skills/` 里的个人技能混进一个受许可的员工；
- 也不能让员工包的 skills 泄漏到用户的其他 pi 会话里；
- 顺带绕开 pi 的 project trust 交互提示（那是给 CLI 设计的，GUI 里不合适）。

### 2.4 Extension 系统：定制的主要着力点

pi 的 extension 是 TypeScript 模块，可注册工具、拦截事件、注册 provider。
本项目会用到的扩展点：

| 扩展点 | 用途 |
|---|---|
| `registerProvider()` | 注册 SEP 模型网关，见 §5.1 |
| `on("tool_call")` | **权限门** —— 可 `return { block: true, reason }` 阻止调用，也可改写 `event.input` |
| `registerTool()` | 注册 SEP 专有工具（如"查看我的授权实例"）|
| `on("agent_start")` / `on("agent_end")` | 凭据守卫、任务边界（用量统计的天然锚点）|
| slash commands | `/employees`、`/switch`、`/update` 等 |
| 状态栏 | 显示登录态、当前实例、令牌剩余时间 |

### 2.5 与上游的关系：不要指望合并补丁

- 版本仍在 `0.x`（撰写时 v0.82.x），语义版本承诺弱；
- 提交频率接近每日；
- **新贡献者的 issue/PR 默认自动关闭**。

**结论**：所有定制走 SDK 参数与 extension，**不改 pi 源码**。
这也是 pi 自己的设计意图（原文：无需 fork 和修改 pi 内部即可适配你的工作流）。
版本策略：锁定一个已验证版本，定期人工评估升级，不追最新。

### 2.6 pi 的两个缺口（务必知道）

**① 没有任何本地权限沙箱。**
pi README 直说：不含限制文件系统 / 进程 / 网络 / 凭据访问的机制，
以启动它的用户权限运行；要边界就去容器化。
→ 这部分是**净新增工作量**，见 §6。

**② 没有原生 MCP 支持。**
如果未来员工形态依赖 MCP 生态，需要自己接。本期不涉及。

**③ 默认会联网 ping 上游。**
版本检查 + 安装遥测，且会给部分 provider 请求加归因头。
商用分发前必须关闭，见 §8.2。

---

## 3. 为什么是 Electron，以及它带来的约束

### 3.1 Tauri vs Electron 的真实差别

这不是"用哪个框架"的口味问题，它决定了**代码切在哪一层**，进而决定了整个 PoC
的风险分布：

| | **Electron（已选）** | Tauri |
|---|---|---|
| 主进程运行时 | **Node.js** | Rust |
| 能否进程内 `import` pi SDK | ✅ 可以 | ❌ 不能 |
| 因此的集成方式 | **进程内直接调 `pi-coding-agent` SDK** | pi 编成二进制当 sidecar |
| 通信层 | 主进程 ↔ 渲染进程 contextBridge IPC | Rust ↔ pi JSONL + Rust ↔ WebView IPC |
| 安装包体积 | 大（带整个 Chromium，框架层 ≈130 MB）| 小（用系统 WebView，框架层 ≈15 MB）|
| 运行时数量 | **1（Node，pi SDK 复用主进程）** | 2（Rust 壳 + pi 自带 JS 运行时）|
| GUI 权限弹窗实现 | **进程内 `await`：renderer 弹窗，主进程 resolve** | Rust ↔ pi ↔ WebView 三跳，需自建 back-channel |

**选 Electron 的代价要提前认清**：

1. **安装包更大**。Electron 携带整个 Chromium，框架层约 130 MB。不过 pi
   无论哪种方案都要带 JS 运行时（`bun build --compile` ≈50–100 MB），
   Electron 让 pi SDK 直接复用主进程 Node、**不再额外带一份运行时**；
   真实差距约 30–50 MB，不是 10× 量级。
2. **内存基线高约 100–200 MB**。可接受 —— pi 本身的对话会话才是内存主要来源。
3. **没有 Rust 的安全保证**。但 SEP 是全 TypeScript 栈，Rust 胶水代码的
   调试成本对本团队来说比内存基线更高。

**为什么不选 Tauri**：Tauri 最大的额外成本落在**最高风险的 PoC 项**上。
本项目最难验证的点是「`tool_call` 事件到达时，异步等待 GUI 弹窗决策再 resolve」。
Electron 里这是一个进程内的 `await`（主进程持有 `session` + renderer 引用，
直接 return Promise）；Tauri 里需要 Rust ↔ pi JSONL ↔ Rust ↔ WebView ↔ Rust ↔ pi
的往返，且 pi RPC 的权限协商行为在该场景下尚未实测，需要自建 back-channel。
这个风险完全没有必要承担。

### 3.2 由此确定的进程模型

```
┌──────────────────────────────────────────────────────┐
│ Electron App (sep-client)                            │
│                                                      │
│  ┌─────────────────────────────────────────────────┐ │
│  │  主进程 (Node.js / electron/main.ts)            │ │
│  │                                                 │ │
│  │  · createAgentSession()  ← pi-coding-agent SDK  │ │
│  │  · session.subscribe(event => ...)              │ │
│  │  · tool_call 拦截 + await GUI 弹窗决策          │ │
│  │  · SEP extension（registerProvider + guard）    │ │
│  │  · safeStorage（refresh token，加密存本地）     │ │
│  │  · contextBridge → 渲染进程（IPC）              │ │
│  └──────────────────┬──────────────────────────────┘ │
│                     │ IPC (contextBridge / ipcMain)   │
│  ┌──────────────────▼──────────────────────────────┐ │
│  │  渲染进程 (React + shadcn/ui)                   │ │
│  │  · 员工列表 / 会话视图 / 权限弹窗 / 日志面板   │ │
│  └─────────────────────────────────────────────────┘ │
└──────────────────────────────────────────────────────┘
                           │ HTTPS
              ┌────────────▼────────────┐
              │ SEP 平台                │
              │  /client/*  /gateway/*  │
              └─────────────────────────┘
```

**凭据存储放在主进程**（Electron `safeStorage`），
不放在 pi 侧，也不放在渲染进程 —— pi 的 auth 文件是明文 JSON，
不适合存平台凭据；渲染进程是 Web 上下文，同样不可信。

**RPC / sidecar 模式保留为降级备选**：若进程内嵌入出现兼容性问题
（ESM/CJS 冲突、Electron 打包问题等），可退回到
`child_process` / `utilityProcess` 启动 pi 二进制 + `--mode rpc`。
Electron 主进程是 Node，两种路径都可行，这正是选 Electron 的隐形价值。

> ⚠️ **JSONL 解析坑**（降级路径适用）：按 `\n` 手工切分，
> **不要用 Node `readline`** —— 它在 Unicode 行分隔符（U+2028 等）
> 上会误拆，pi 文档有明确警告。

### 3.3 多会话（多员工并发）

进程内调 SDK 时，`createAgentSessionRuntime()` / `AgentSessionRuntime`
是标准的多会话管理入口，比 RPC 多会话路由更直观。

**MVP 建议：单会话**。同一时刻只有一个员工在跑，切换即重建会话。
符合"前期尽量简单"的要求。

---

## 4. 前期范围：只做最简且必要的

用户明确要求「前期做尽量简单且必要的东西」。以下是把范围压到最小后的划线。

### 4.1 P-A 阶段：最小可用（MVP）

**目标**：一个企业员工能装上客户端、登录、看到他被授权的员工、
运行出结果、平台能看到算力消耗。

必须有：

- [ ] Electron 主进程内嵌 `pi-coding-agent` SDK，`createAgentSession()` 正常运行（ESM/CJS + Electron 打包兼容性验证）
- [ ] 账号密码登录，refresh token 存 Electron `safeStorage`
- [ ] 拉取「我被授权的实例」列表并展示
- [ ] 加载一个员工（构造 ResourceLoader，挂 skills）
- [ ] SEP 网关 provider（所有模型调用经平台，见 §5.1）
- [ ] 运行视图：把 pi 事件流渲染成「进度」（不是聊天气泡）
- [ ] 工具白名单（构造期收口）
- [ ] 高危工具的 GUI 批准弹窗
- [ ] 凭据守卫：无有效凭据时拒绝执行并明确提示（不静默降级）
- [ ] 去品牌化 + 关闭上游遥测

**明确不做**（推迟）：

| 推迟项 | 理由 |
|---|---|
| 多员工并发 | 技术不确定性最高，单会话够用 |
| 配置表单渲染器 | 依赖清单格式（未定），先用固定表单或直接跳过 |
| 员工包自动更新 | 手动重新拉取即可 |
| 本地知识库 | v3 §8.3 待确认问题 3，未定 |
| 任务上报 | v3 决策 15 明确本期不做，只在协议里留字段 |
| 容器化沙箱 | 决策 4 已定：白名单 + 弹窗 |
| 激活码入网 | 决策 3 已定：用登录 |
| MCP | 无需求 |
| 计划任务 | 需要客户端拉取机制，本期不做 |

### 4.2 P-B 阶段：可交付产品

- 配置表单驱动（等清单格式定了）
- 员工包更新检测与一键更新
- 多员工并发（如产品确需）
- 心跳 + 吊销联动的锁定态
- 用量本地展示（仅展示，不作计费依据）

### 4.3 界面结构（MVP）

主界面不是 ChatGPT。v3 §2.1 定的交互是「配置表单驱动，对话为辅」，
目标用户是企业里的普通员工，不是开发者。

```
┌──────────┬──────────────────────────────────┐
│ 我的员工 │  员工详情 / 运行区                │
│          │                                  │
│ ● 视频   │  ┌────────────────────────────┐  │
│   工程师 │  │ 我能做什么（来自模板描述）  │  │
│          │  └────────────────────────────┘  │
│ ○ 文案   │  ┌────────────────────────────┐  │
│   助理   │  │ 配置区（P-B：清单驱动表单）│  │
│          │  └────────────────────────────┘  │
│ ○ 数据   │  ┌────────────────────────────┐  │
│   分析师 │  │ [ 开始工作 ]               │  │
│          │  ├────────────────────────────┤  │
│          │  │ 进度：                     │  │
│──────────│  │  ✓ 读取素材目录            │  │
│ ⚙ 设置   │  │  ⟳ 生成脚本…               │  │
│ 👤 张三  │  │                            │  │
│ 硅基科技 │  │ ▸ 详情（对话形式，可折叠） │  │
└──────────┴──┴────────────────────────────┴──┘
```

**事件到界面的映射**（同一套 pi 事件，换个呈现方式）：

| pi 事件 | 界面呈现 |
|---|---|
| `text_delta` | 过程叙述（可折叠的详情区）|
| `tool_execution_start` | 新增一条进度项，转圈 |
| `tool_execution_end` | 该进度项打勾 / 标红 |
| `agent_end` | 完成态 + 本次用量 |
| `tool_call`（被 block）| 权限拒绝提示 |
| 待批准 | 弹窗，见 §6.3 |

---

## 5. 客户端 ↔ SEP 平台的关联

**重要前提**：SEP 后端**目前完全没有面向客户端的接口**。
现有 9 个模块（auth / capability / conversation / digital-employee /
enterprise / model / setting / subscription / users）里没有 device、
没有 client credential、没有 EmployeePackage 模型、没有模型网关。
这些都要在 SEP 侧新建 —— 属于本项目的**跨仓库依赖**，见 §9。

### 5.0 接口清单（SEP 侧待建）

| 接口 | 用途 | 阶段 |
|---|---|---|
| `POST /client/login` | 账号密码登录 → refresh token + 设备登记 | P-A |
| `POST /client/token` | refresh → 短期 access token（**按实例签发**）| P-A |
| `GET /client/instances` | 我被授权的实例清单 + 配置 + 锁定版本 + 包引用 | P-A |
| `POST /gateway/v1/chat/completions` | OpenAI 兼容模型网关（计量唯一入口）| P-A |
| `POST /client/heartbeat` | 设备状态 + 壳版本 → 返回吊销 / 升级指令 | P-B |
| `POST /client/reports` | 任务上报，**预留不实现**（v3 决策 15）| — |

### 5.1 模型网关：最关键的一环

**原则（v3 §5.2）**：客户端**永远不持有上游 API Key**。
一旦下发，凭据即泄漏、用量无法归属、额度无法控制、吊销失效。

**pi 侧实现**：extension 里注册一个自定义 provider，
`baseUrl` 指向 SEP 网关，在 API Key 的 `resolve()` 回调里
向平台换取短期令牌。

```
registerProvider(createProvider({
  id: "sep-gateway",
  baseUrl: <SEP_GATEWAY_URL>,
  api: <OpenAI 兼容>,
  auth: { apiKey: { resolve: async () => {
    const token = await refreshAccessToken();   // 每次动态取
    return { auth: { apiKey: token }, source: "SEP 短期令牌" };
  }}},
  models: [ /* 平台白名单下发 */ ],
}))
```

两个关键性质：

- `resolve()` 是**每次调用时求值**的，所以短期令牌可以随时轮换，
  不需要重启会话；
- pi 还提供 `modelRuntime.setRuntimeApiKey()`，文档明确说**不持久化到磁盘** ——
  正好是短期令牌该有的行为。绝不要写进 pi 的 auth 文件。

> 对比历史方案：早期考虑过用 OpenCode 并改写 `ANTHROPIC_BASE_URL`
> 环境变量来劫持调用方向。那是绕行；`registerProvider` 是官方扩展点。
> 这是 pi 相对 OpenCode 的主要优势。

**网关每次请求校验四件事**：令牌有效 → 实例状态 `ACTIVE` →
授权关系仍存在 → 企业算力余额充足。通过则转发 sub2api，
并记 `ComputeTransaction`。

**令牌必须按实例签发**（claims 携带 `enterpriseId` / `instanceId` / `memberId`）。
否则 v3 §8.1 ③ 要求的「用量按实例维度拆分」做不到 ——
你只会知道这家企业花了多少，不知道是哪个部门的员工花的。

**令牌有效期**用平台现有的 `SystemSetting` 机制配置
（v3 决策 5 已定；汇率配置刚用这套验证过），不要硬编码，也不要新建机制。
建议初值：分钟级（如 15 分钟）。

### 5.2 登录（替代 v3 的激活码）

**这是对 v3 §4.2 的一处修正，已获确认。**

v3 原设计是「企业管理员签发激活码 → 用户首次启动输入 → 登记指纹」。
那套机制是为**没有好登录 UX 的 ZIP / CLI 形态**做的妥协。
有了 GUI 之后这个约束消失了：

- 客户端直接用平台账号密码登录；
- refresh token 存 Electron `safeStorage`（OS 级加密，主进程持有，不落渲染进程）；
- 比让管理员人工分发一串码更简单，也更安全。

**保留的部分**：设备指纹 + 可吊销的设备记录。那是吊销能力的基础，
和激活码不是一回事，不要一起砍掉。

**激活码降级**为「IT 统一批量部署场景下的备用入网方式」，非主路径。
（v3 P3.4 本来就写了激活凭据 MVP 可选，此改动不与已有决策冲突。）

### 5.3 实例加载

登录成功 → `GET /client/instances` → 得到形如：

```
[{
  instanceId, displayName,          // 企业内自定义名称，如"视频工程师"
  templateId, lockedVersion,        // 锁定版本，用于提示式升级
  packageRef,                       // pi package 引用，见 §7
  config,                           // 企业侧配置
  allowedTools,                     // 工具白名单
  allowedModels,                    // 模型白名单
  status                            // ACTIVE / SUSPENDED / REVOKED
}]
```

**客户端不传任何过滤参数。** 服务端从 token 取 `memberId` →
反查企业 → 反查 `EmployeeGrant`（授权给我，或授权给我所在部门）→
过滤 `status = ACTIVE`。见 §6.1。

每个实例映射到本地一个隔离目录：

```
~/Library/Application Support/sep-client/     (macOS)
├── auth/                    凭据元数据（敏感凭据走 Electron safeStorage，此处只存非敏感元数据）
├── instances/
│   └── <instanceId>/
│       ├── package/         员工包内容
│       ├── config.json      企业配置 + 用户填写的配置
│       └── workspace/       该员工唯一被允许读写的目录（见 §6.2）
└── logs/
```

### 5.4 心跳与吊销

后台定时器（建议 5 分钟）`POST /client/heartbeat`，带 access token。

- 连续失败超阈值 → 进入**锁定态**：显式提示「无法连接平台 / 授权已变更」，
  并对所有 `tool_call` 事件 `return { block: true }`；
- refresh 返回 401 → 同样锁定，明确提示原因；
- **不静默降级**（v3 验收标准第 9、12 条）。

**吊销的时效性由令牌 TTL 决定** —— 已下发的短期令牌在有效期内
仍然可用。这是 v3 §5.3 已经承认的设计取舍，不是 bug。

### 5.5 计量的可信边界

**网关记账是唯一可信来源。** 这一点不要动摇。

pi-ai 自身返回 `usage.cost`，但那只能用于客户端本地展示
（让用户看到这次任务大概花了多少），**不能作为计费依据** ——
客户端代码在用户手里，不可信。

**一个未来的便宜收益**：GUI 里「用户点击开始工作」天然划出了任务边界，
`agent_start` / `agent_end` + usage 就是一条完整的任务记录。
v3 决策 15 说本期不上报，但真要打开时，成本远低于 CLI 形态。
**现在只需在 RPC 协议里留出字段，不实现逻辑。**

---

## 6. 权限控制：两个不相干的问题

v3 把这两件事混在一起谈了。实现上必须分开，因为它们的威胁模型完全不同。

### 6.1 平台侧权限（企业内角色）—— 后端的事，客户端只是消费者

SEP 后端已有的多租户隔离基线（v3 开发顺序方案 P0.4）在有了桌面客户端后
**重要性上升一个档**。理由很直白：

> 浏览器前端好歹在你们发的页面里跑。
> **桌面客户端是完全落在攻击者手里的代码。**
> 任何"客户端会规矩地只请求自己的数据"的假设都不成立。

P0.4 的 5 条验收项直接适用于所有 `/client/*` 接口，第 1、5 条尤其：

1. A 企业用户带自己的合法 token，构造 B 企业资源 ID 调接口 → 必须 404/403；
2. 列表接口无显式过滤参数时，默认只返回本企业数据；
3. 普通成员调管理员专属接口 → 必须 403；
4. `ComputeTransaction` 这类间接归属对象同样拒绝跨企业访问；
5. **客户端伪造请求体里的 `enterpriseId` 不生效**（以服务端上下文为准）。

**给客户端开发者的行动项**：不要设计任何"客户端传 enterpriseId / instanceId
让服务端按此查询"的接口。如果你发现自己需要这样的接口，说明设计错了。

### 6.2 客户端本地权限 —— pi 完全没有，是净新增工作

#### 先把威胁模型说清楚

**这一层要防的不是终端用户。** 他改客户端、拷 skills、直接调 API，
都防不住 —— v3 §2.2 已经明确接受了这个前提。

**要防的是**：

1. 员工包作者写了越界的 skill（有意或无意），把企业员工的电脑当自己家；
2. 用户被员工包里的文本诱导做了不知后果的事
   （skills 是纯文本，会被模型当指令执行 —— 这是 prompt injection 的一种形态）；
3. 某个员工访问了它不该访问的企业文件。

按这个威胁模型，四道措施够用，**不需要一上来就上容器**（决策 4 已定）。

#### 四道措施

**① 声明（清单层）**
员工包清单声明所需本地权限（v3 §6 已列：文件读写 / 网络 / 剪贴板等）。
上架审核时比对「声明」与「skills 实际内容」是否一致。

**② 构造期收口（最有效的一道）**
每个员工的 session 只给它声明过的工具。
一个只做文档整理的员工，**不该拿到 `bash`**。
pi 支持 `noTools: "builtin"` 后按需 `registerTool`，或用 `tools` 白名单。

> 这道措施成本最低、效果最好。优先做这个，而不是先做复杂的运行期检查。

**③ 运行期拦截（`tool_call` 事件）**
extension 的 `tool_call` 钩子能 `return { block: true, reason }`，
也能直接改写 `event.input`。用它做：

- **路径白名单**：文件工具的目标路径必须在
  `instances/<instanceId>/workspace/` 之内，或用户显式选择过的目录。
  注意规范化路径后再比对，防 `../` 逃逸和符号链接。
- **bash 命令策略**：如果某员工确实需要 `bash`，
  至少拦截明显危险的模式，并升级为需批准。
- **网络域名白名单**：按清单声明。

**④ 用户可见的批准（GUI 的实质优势）**
pi 刻意不做权限弹窗（CLI 场景的取舍）。
**但 GUI 里做弹窗是自然的 —— 这恰好是 GUI 相对 CLI 的核心优势之一。**

```
┌─────────────────────────────────────┐
│ ⚠ 「视频工程师」请求执行            │
│                                     │
│   写入文件                          │
│   ~/Documents/项目A/脚本.md         │
│                                     │
│  [ 拒绝 ]  [ 允许一次 ]  [ 总是允许 ]│
└─────────────────────────────────────┘
```

「总是允许」的记忆**按员工实例 + 操作类型**缓存，不要全局记忆。

#### 容器化：可选加固，不做 MVP 默认

pi 文档提供三种隔离模式（Gondolin micro-VM / Docker / OpenShell）。
留给有明确合规要求的企业作为可选项，MVP 不做。

### 6.3 权限的三层关系（一图讲清）

```
第一层  平台后端        ← 唯一真正的安全边界
        校验 token、企业归属、授权关系、余额
                ↑ 无法绕过（服务端）

第二层  客户端构造期    ← 有效但可被改客户端绕过
        只给声明过的工具

第三层  客户端运行期    ← 体验层 + 防止员工包作者越界
        路径白名单、批准弹窗
```

**不要把第二、三层当安全边界。** 它们的价值是
"防止员工包越界"和"不让用户点到会失败或危险的东西"，
不是"防住攻击者"。真正的拦截永远在后端。

---

## 7. 员工包：复用 pi 的 package 机制

**决策 5 已定：不自建 ZIP + 下载令牌，复用 pi 自己的 package 机制。**

### 7.1 这个决策改变了什么

pi 原生支持从 npm 或 git 安装 package，且支持锁定 tag / commit。
这意味着：

| | v3 原方案（ZIP + 下载令牌）| **本方案（pi package）** |
|---|---|---|
| 制品仓库 | 平台自建，需存储 + CDN | **复用 npm / git registry** |
| 版本管理 | 平台自建 `EmployeePackage` 表 | registry 天然支持 |
| 完整性校验 | 自己算 SHA-256 | registry 自带（npm integrity / git commit hash）|
| 下载鉴权 | 带时效的下载令牌 | ⚠️ **绕过了平台** —— 见下 |
| 客户端加载 | 解压 → 放到 skills 目录 | pi 原生安装流程 |
| 工作量 | 大 | **小** |

**省下的工作量很可观**：不用做制品上传、存储、CDN、下载令牌签发、
SHA-256 校验、解压。这符合「前期尽量简单」的要求。

### 7.2 必须正视的取舍：分发鉴权被绕过

pi 从 registry 拉包，**平台不在这条链路上**。所以：

- 平台无法拦截「未订阅企业下载员工包」；
- 如果用公开 registry，包内容对所有人可见。

**这个取舍是可以接受的，理由**：

真正的锁在**模型网关**（§5.1），不在包分发上。
员工包拿到了但没有平台凭据 → 拿不到模型能力 → 是个空壳。
这正是 v3 §2.2 已经确立的安全取向：

> 不追求"防住恶意用户"（本地代码理论上都可绕过），而是做到
> **未授权无法获得可用凭据 → 拿不到模型能力，员工是个空壳**。

**如果确实需要控制包的可见性**，有两条渐进路径（不在 MVP）：

1. 私有 registry + 平台按订阅关系发 registry 凭据；
2. 平台做 registry 代理，在代理层校验订阅。

### 7.3 平台侧仍然需要记录的东西

即使不自建制品仓库，`EmployeeTemplateVersion` 仍需存 **packageRef**：

```
packageRef: { type: "npm" | "git", spec: "@sep/employee-video@1.2.0" }
```

理由：
- 提示式升级（v3 决策 14）需要平台知道"最新版是哪个 ref"；
- 实例锁定版本（`lockedVersion`）需要能映射到具体 ref；
- 上架审核需要审核对象。

### 7.4 清单格式：暂缓决定（对应 v3 §8.3 问题 2）

用户答复是「我也不知道，总之前期做的尽量先简单且必要的东西」。
**处理方式**：不在本阶段定一个大而全的清单规范。

**MVP 做法**：pi package 本身就有元数据文件。在其中加一个
`sep` 扩展字段，只放 MVP 真正需要的三项：

```
sep:
  templateId:      平台侧模板 ID
  allowedTools:    工具白名单（对应 §6.2 措施 ②）
  localPermissions: 声明的本地权限（对应 §6.2 措施 ①）
```

**暂不做**：配置模式定义（`configSchema`）。它是配置表单渲染器的前置，
而表单渲染器已推迟到 P-B。等到真要做表单时再定，且届时建议直接产出
JSON Schema —— 这样 SEP web 端（已用 react-hook-form + zod）
和客户端可以共用一套渲染逻辑。

> ⚠️ 这条推迟有代价：v3 §2.1 定的核心交互是「配置表单驱动」。
> MVP 用固定表单或无表单，意味着 **MVP 还不是最终形态的产品**，
> 只是技术链路的验证。这一点要向业务方讲清楚，别让人以为 MVP 就是成品。

---

## 8. 工程事项

### 8.1 仓库与技术栈

**独立仓库**（已确认：「这个项目就是要做成一个独立的项目进行二次开发的」）。

建议名称：`sep-client`。

```
sep-client/
├── electron/             主进程（Node.js）
│   ├── main.ts               app 入口，BrowserWindow 创建
│   ├── preload.ts            contextBridge IPC 声明（渲染进程可用的 API）
│   ├── pi-host.ts            createAgentSession + event 分发 + tool_call 拦截
│   └── credentials.ts        Electron safeStorage 封装
├── src/                  渲染进程（React + TS）
│   ├── components/ui/        ← 从 SEP web 移植 shadcn 组件
│   ├── features/
│   │   ├── auth/             登录
│   │   ├── instances/        我的员工列表
│   │   ├── run/              运行视图（事件流 → 进度）
│   │   └── permission/       批准弹窗
│   └── lib/
├── pi-extension/         注入 pi 的 SEP extension（TypeScript）
│   ├── provider.ts           SEP 网关 provider
│   ├── guard.ts              tool_call 权限门
│   └── index.ts
├── scripts/
│   └── lock-pi-version.sh    锁定并记录使用的 pi 版本（npm install + 记录 lockfile）
└── docs/
```

**前端栈**与 SEP web 端保持一致，便于人员流动和组件复用：
React + TypeScript + Tailwind + shadcn/ui。
状态管理按需（客户端场景比 web 简单，TanStack Query 可能过重，
Zustand + Electron IPC/contextBridge 可能就够）。

### 8.2 去品牌化与遥测（商用分发前必做）

pi 默认行为：
- 启动时 ping `pi.dev` 做版本检查；
- 安装遥测；
- 给部分 provider（OpenRouter / Cloudflare / NVIDIA）请求加归因头。

关闭方式：
- 环境变量 `PI_OFFLINE=1`、`PI_SKIP_VERSION_CHECK=1`；
- settings 里 `enableInstallTelemetry: false`。

目录与命令名同样要改（pi 默认用 `~/.pi/agent`、`.pi/`、`pi`）。
好在 SDK 支持自定义 `agentDir` / `authPath` / `modelsPath`，
**不需要 fork 改内部**。用 §5.3 的目录结构。

> ⚠️ **待实测确认**：上述网络行为是按 CLI 启动路径描述的。
> SDK / RPC 嵌入路径是否也触发，**必须实测**，不要假设。
> 用抓包或断网测试验证，这是合规相关项。

### 8.3 许可与合规

- pi 是 **MIT** —— 允许商用、允许修改、允许闭源分发；
- 义务：保留版权声明和许可文本。在客户端「关于」页放开源许可声明。
- 同时要过一遍 pi 的**传递依赖**许可（MIT 项目也可能引入 GPL 依赖）。
  建议 CI 里加许可扫描。

### 8.4 PoC：开工前先验证的四件事

建议第一周就把这四件事跑通，它们是整个方案的技术前提。
**任一失败都需要回头重新讨论方案**。

| # | 验证内容 | 失败意味着 |
|---|---|---|
| 1 | Electron 主进程中 `import`/`require` `pi-coding-agent`，`createAgentSession()` 可正常运行（ESM/CJS 兼容性、Electron 打包工具无 native module 冲突） | 进程内集成路线不成立，需退回 RPC/sidecar 降级方案 |
| 2 | 自定义 provider 走一个假网关，`resolve()` 每次被调用、令牌可轮换 | 计量与吊销方案不成立 |
| 3 | `tool_call` 拦截能 block，能从主进程 `await` renderer 弹窗的用户决定后再 resolve | 权限方案不成立（钩子 API 是否支持异步返回需实测确认）|
| 4 | 断网 / 令牌失效时，客户端明确拒绝且提示，不静默降级 | v3 验收 9、12 条不达标 |

第 1 条是 Electron 方案特有的验证：pi SDK 的发布格式（ESM/CJS/混合）在 Electron
打包环境下的兼容性无法靠文档确认，必须实测。第 3 条相比 Tauri 方案风险大幅降低 ——
主进程持有 session 引用，从主进程 await renderer Promise 是标准 Electron 模式；
但**钩子 API 本身是否支持异步返回**（而非同步 block/allow）仍需确认。

---

## 9. 跨仓库依赖：SEP 侧需要新建的东西

**客户端无法独立交付。** 以下 SEP 侧工作是客户端的前置依赖，
需要和 SEP 团队协调排期。

| SEP 侧工作 | 客户端的哪部分依赖它 | 阻塞程度 |
|---|---|---|
| `POST /client/login` + 设备登记模型 | 登录 | 🔴 硬阻塞 |
| `POST /client/token`（按实例签发） | 所有 API 调用 | 🔴 硬阻塞 |
| `GET /client/instances` | 员工列表 | 🔴 硬阻塞 |
| **模型网关** `/gateway/v1/*` | 一切实际工作 | 🔴 硬阻塞 |
| `EmployeeTemplateVersion.packageRef` 字段 | 员工包加载 | 🔴 硬阻塞 |
| 令牌有效期 `SystemSetting` 项 | 令牌刷新 | 🟡 可先硬编码 |
| `POST /client/heartbeat` | 吊销联动 | 🟡 P-B |
| 上架审核比对声明 | 权限措施 ① | 🟢 运营流程，非技术阻塞 |

**可以并行的部分**：PoC 的 4 项（§8.4）均可在无真实 SEP 后端的情况下先行验证
（第 2 项用本地假网关）。所以客户端可以先开工，
不必等 SEP 接口就绪。

### 排期上的一个提醒

v3 的开发顺序方案 P0–P5 里**没有客户端的位置** ——
P3 只做到「下载 ZIP + 说明书」，客户端壳在 v3 §10 的阶段九，
且依赖当时的待确认事项。

**引入 pi 不是替换 P3 的实现细节，而是往路线图里插入一个新的、
体量不小的模块。** 这个排期后果需要在正式动工前和业务方确认。

同时，采用 pi package 机制（决策 5）让 v3 的 P3.1（`EmployeePackage`
制品仓库）和 P3.2（下载令牌）**大幅简化甚至可以取消**，
这部分省下的工作量可以对冲一部分客户端的新增工作量。

---

## 10. 对 v3 方案的修正清单

本文档相对 v3 有以下**已确认的变更**，v3 文档应据此更新：

| v3 位置 | 原内容 | 修正 | 依据 |
|---|---|---|---|
| §8.3 问题 1 | 客户端技术选型待确认 | ✅ **Electron** + 进程内 `pi-coding-agent` SDK | 本次决策 1 |
| §8.3 问题 2 | 清单格式待确认 | ⏸️ 暂缓；MVP 只在 pi package 元数据加 `sep` 扩展字段 | 本次决策 2 |
| §4.2 | 激活码 + 指纹登记 | ✅ 改为**账号登录**；保留设备指纹与可吊销设备记录 | 本次决策 3 |
| §6 依赖声明 | 声明本地权限 | ✅ 强度定为**工具白名单 + GUI 批准弹窗**，不做容器化 | 本次决策 4 |
| §4.1 / P3.1 / P3.2 | 员工包 = 平台自建 ZIP 仓库 + 下载令牌 | ✅ 改为**复用 pi package 机制**（npm/git，可锁 tag）；平台只存 `packageRef` | 本次决策 5 |
| §10 阶段九 | 「统一客户端壳实现」，依赖待确认 | ✅ 解除阻塞，成为**独立项目 sep-client** | 本次 |
| §7.1 员工侧 | 交付物 = 压缩包 + 说明书 | ⚠️ 演进为 = pi package + 客户端加载 | 决策 5 连带 |
| 验收标准 4 | 下载 ZIP 并校验 SHA-256 | ⚠️ 改为：客户端能安装指定版本的 pi package | 决策 5 连带 |
| 验收标准 5 | 用激活码成功激活 | ⚠️ 改为：用账号登录，拉到被授权实例清单 | 决策 3 连带 |

**未变更、仍然有效的核心决策**（不要因为换了底座就动摇）：

- 平台是分发与授权层，不是运行时（v3 §2）；
- 必须联网，不支持离线（决策 3）；
- 所有模型调用经平台网关，不下发上游 Key（§5.2）—— **这是整个商业模式的锚点**；
- 网关记账是唯一可信计量来源（§8.0）；
- 一个壳装多个员工（决策 1）；
- 提示式升级，不自动跟进（决策 14）；
- 任务本期不上报，协议留字段（决策 15）；
- 多租户隔离是安全基线（开发顺序方案 P0.4）。

---

## 11. 仍然没有答案的问题

交给下一轮讨论，**不阻塞 MVP 开工**：

| # | 问题 | 何时必须有答案 |
|---|---|---|
| 1 | 配置模式定义（清单的 `configSchema`）格式 | 做配置表单渲染器之前（P-B）|
| 2 | 本地知识库读取方式（客户端直读 / 索引后上传摘要）| 知识库功能开工前；v3 §8.3 问题 3 |
| 3 | 第一个真实员工做什么、由谁做 | 端到端联调前；v3 §8.3 问题 5，**整条链路唯一没有归属的环节** |
| 4 | 多员工并发是否是产品必需 | P-B 开工前 |
| 5 | 是否需要私有 registry 控制包可见性 | 有客户明确要求时 |
| 6 | 员工包内敏感凭据（Coze / n8n 的 key）如何托管 | v3 决策 16 标注「暂不处理」，遇到第一个需要外部凭据的员工时 |
| 7 | pi 版本升级策略与频率 | 锁定首个版本后 |

---

## 附录 A：关键文件索引（SEP 仓库）

| 内容 | 位置 |
|---|---|
| v3 架构方案 | `docs/architecture/v3/硅基员工平台-方向调整设计方案-v3.md` |
| 开发优先级 | `docs/plans/项目升级开发顺序方案v3.md` |
| 数据模型 | `backend/prisma/schema.prisma` |
| 共享 DTO / Zod schema | `backend/src/shared/` |
| sub2api 接入与计费 | `docs/research/sub2api用量追踪与计费对接调研.md` |
| 现有 UI 组件（可移植） | `web/src/components/ui/` |
| 项目约定 | `CLAUDE.md` |
| agent runtime 选型对比 | `docs/对接/agent-runtime-对比.md` |

## 附录 B：pi 官方资料

| 内容 | 获取方式 |
|---|---|
| 仓库 | `github.com/earendil-works/pi` |
| SDK 文档 | 仓库内文档目录 |
| Extension API | 仓库内文档目录 |
| RPC 协议 | 仓库内文档目录 |
| 二进制编译脚本 | 仓库内 `build:binary` 相关脚本 |

> ⚠️ 撰写本文档时 github.com 在开发环境不可直接访问，
> 相关资料通过 `raw.githubusercontent.com` 和 `gh api` 获取。
> 本文档中所有关于 pi 的行为描述**基于其官方文档**，
> 标注为「待实测确认」的项目必须在 PoC 阶段实际验证。
