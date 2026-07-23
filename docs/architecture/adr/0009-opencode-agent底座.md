# ADR-0009：OpenCode + SKILL.md 作为 SEP Agent 执行底座

状态：已接受

日期：2026-07-21

## 背景

SEP 平台要把 Agent / RPA / Skill / AI 应用四类能力统一包装成"硅基员工"对外售卖。
其中 **Agent + Skill 是最高优先级的交付形态**：一个"硅基员工"= 一个带领域知识
（Skills）的 Agent，接收任务 prompt，自主调用 MCP 工具，输出结果。

实现这个形态，平台需要选定一个 **agent runtime**，满足以下约束：

1. **可被 Gateway 程序化调用**（无头/非交互模式），不依赖人工终端。
2. **支持 SKILL.md 标准**，能按任务按需加载领域技能，进行渐进式上下文管理。
3. **模型路由走 SEP ModelRelayClient**：所有模型调用必须经平台自有算力路由，
   先接国内模型（DeepSeek / 火山 / 千问）；agent 不得直连第三方模型平台。
4. **商用授权无摩擦**：平台对企业客户转售，agent runtime 必须允许商用嵌入。
5. **可自托管**，不强依赖第三方 SaaS 的鉴权与可用性。

候选方案评估见 [`docs/对接/agent-runtime-对比.md`](../../对接/agent-runtime-对比.md)。

---

## 评估过的替代方案

### 方案 A：Claude Code（`claude -p` + Agent SDK）

- **优势**：SKILL.md 发明者，实现最完整；Agent SDK（Python/TS）可原生嵌入后端；
  生态最丰富，推理质量广受认可。
- **致命缺陷**：
  - **闭源 + ToS 约束**：把官方 CLI 嵌入转售商品存在合规风险，Anthropic
    可能不允许。
  - **模型锁定**：官方仅支持 Claude；通过 `ANTHROPIC_BASE_URL` 绕行会触发
    内部 `custom3p` 企业配置校验，每次版本升级均有破坏风险。
  - **算力主权**：鉴权锚定在 Anthropic 官方 Key，无法真正把模型消费归到 SEP
    自有 relay。

### 方案 B：OpenAI Codex（`codex exec`）

- **优势**：推理严谨，exec 模式专为非交互设计，支持 SKILL.md。
- **致命缺陷**：
  - 深度绑定 OpenAI 模型体系，切换国内模型需重代理层。
  - 同属闭源 + ToS 商用风险。
  - 国内网络环境访问不稳定。

### 方案 C：OpenCode（本决策选定）

- **优势**：MIT 开源，无商用授权风险；模型无关（75+ provider），`baseUrl` 直接
  指向 SEP relay；完整实现 SKILL.md 标准；有生产案例验证（`yaoruiquan/opencode-skiills-service`
  已在漏洞上报、内容生成等任务上跑通 skills + MCP + 无头调用全链路）。
- **权衡**：agent 本身推理能力与 Claude Code 有差距；开源社区维护稳定性不如
  官方产品。但这个差距可通过模型选型（指向最强国内/国际模型）弥补；而前述
  两方案的授权与模型锁定问题是架构性的，无法靠配置修复。

---

## 决策：选用 OpenCode 作为 SEP Agent 执行底座

### 核心理由

**授权 > 能力**：在"要转售的商用平台"这个约束下，MIT 开源 + 模型无关是不可妥协
的前提；Claude Code / Codex 的授权与锁定问题是架构性缺陷，不是配置问题。

**三条硬约束全部满足**：

| 约束 | 满足方式 |
|---|---|
| 模型走 SEP relay | 配置 OpenCode `baseUrl` 指向 `ModelRelayClient` 端点，ApiKey 用 SEP 分发的 key |
| 先接国内模型 | SEP relay 已接入 DeepSeek/火山/千问，OpenCode 无感知 |
| 商用转售 | MIT 授权，无限制 |

**技能资产可移植**：SKILL.md 是 Linux 基金会开放标准，今天写的 skills 未来可迁移到
任意支持该标准的 agent。技能不被 OpenCode 绑死。

### 实现路径

#### 1. Gateway 新增 `opencode_skill` Provider

与现有 `coze_workflow` 适配器平级，在 Gateway 里新增 `opencode-skill-adapter.ts`。

```
Gateway 调度流程：
  接到 Invocation → 读 CapabilityVersion.runtimeKind
    → 分支 "opencode_skill"
    → OpenCodeSkillAdapter.invoke(prompt, skillName, config)
      → spawn opencode run --attach <server> --dir <jobDir>
                          --model <relay-model> --format json
                          --dangerously-skip-permissions <prompt>
      → 轮询 stdout JSONL → 回调 Platform API
```

这与现有 `async_poll` 交互模式和 `ProviderExecution` 租约表天然对齐，
**Gateway 核心调度、Platform 授权链、ModelRelay 均零改动**。

#### 2. Manifest V2 新增 `opencode_skill` profile

```typescript
// 在 RuntimeKindSchema 和 CapabilityTypeSchema 扩展：
// RuntimeKind: "opencode_skill"
// CapabilityType: "skill"（区分自研 prompt_skill）

// RuntimeBinding（opencode_skill 专用）：
{
  profile: "opencode_skill",
  skill_name: string,      // /root/.agents/skills/{name}/SKILL.md
  skill_version: string,   // Git commit SHA 或 semver
  base_url: string,        // OpenCode server 端点
  secret_profile_ref: string  // 指向 SecretsProfile 中的 relay API Key
}
```

#### 3. OpenCode server 指向 SEP ModelRelayClient

```bash
# OpenCode server 启动时注入环境变量
ANTHROPIC_BASE_URL=http://gateway-internal:4096/relay   # SEP relay 端点
ANTHROPIC_API_KEY=${SEP_RELAY_TOKEN}                     # SEP 分发的算力 key
```

OpenCode 使用 Anthropic 兼容格式调用，relay 层做 provider 路由，
**对 OpenCode 完全透明**，符合"模型调用必须经 ModelRelayClient"的不变量。

#### 4. Skills 目录管理

- Skills 以 SKILL.md 格式存在平台的 skills 仓库（类似 `@sep/capability-sdk` 的扩展）。
- 每个 skill = 一个 SEP `Capability`，`runtimeKind = "opencode_skill"`。
- `CapabilityVersion` 的 `runtimeEntry` 记录 skill 目录名称；
  `packageUri`/`packageSha256` 记录 skill 包的内容寻址 blob。
- OpenCode server 挂载 skills 目录；Gateway 调用时传入对应 `SKILL_ROOT`。

---

## 后续跟进（非本 ADR 范围，记录供排期参考）

| 事项 | 优先级 | 说明 |
|---|---|---|
| 补充 `RuntimeKindSchema` 枚举 + `opencode_skill` Manifest V2 profile | 高 | 现有枚举 `rpa_process`/`ai_app`/`n8n_workflow` 也只有枚举名，无 schema |
| 实现 `opencode-skill-adapter.ts` | 高 | 参考 `coze-workflow-adapter.ts` 结构 |
| `@sep/capability-sdk` 实现 skill 打包/校验工具 | 中 | 现在是空壳 |
| RPA 能力形态（`rpa_process`）另立 ADR | 中 | 依赖客户端，与 agent 路径完全不同 |
| AI 应用嵌入形态（`ai_app`）另立 ADR | 低 | Web 嵌入/入口聚合，MVP 后再议 |

---

## 不变量（不得违反）

- OpenCode server 调用模型**只能指向 SEP ModelRelayClient**，不得直连任何第三方
  模型平台（DeepSeek / 火山 / 千问等由 relay 管理）。
- Skills 中不得硬编码任何 API Key、账号、密码；凭据通过 `SecretProfile` 注入。
- 已发布的 skill 版本（`CapabilityVersion`）不可变，绑定固定精确版本。
- Gateway 不连 SEP 数据库（不变量 §8），opencode-skill-adapter 同样禁止直接读写 DB。

---

*关联文档：*
- [`docs/对接/agent-runtime-对比.md`](../../对接/agent-runtime-对比.md) — 三 agent 详细技术对比
- [`docs/architecture/adr/0008-人才市场实例化模型.md`](./0008-人才市场实例化模型.md) — 客户侧碳基/硅基员工模型
- [`apps/gateway/src/coze-workflow-adapter.ts`](../../../apps/gateway/src/coze-workflow-adapter.ts) — 现有 adapter 参考实现
- [`packages/contracts/src/manifest.ts`](../../../packages/contracts/src/manifest.ts) — Manifest V1/V2 schema（需扩展）
