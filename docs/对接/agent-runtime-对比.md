# Agent Runtime 技术调研对比

> 调研日期：2026-07-21  
> 调研目的：评估 OpenCode / Claude Code / Codex 能否作为 SEP"硅基员工" agent 执行底座  
> 结论摘要：三者技术上均可无头调用并加载 Skills；OpenCode 是唯一满足商用授权、国内模型路由和算力主权三条硬约束的选项。

---

## 一、调研背景

SEP 平台的"硅基员工"执行路径需要一个 **agent runtime**，能够：

1. **无头（headless）被 API 驱动**：由 Gateway 发起调用，不需要人在终端交互。
2. **加载 Skills**：按 SKILL.md 标准封装的领域知识/操作规程，按需按能力分派。
3. **接入 MCP 工具**：浏览器自动化、本地文件、外部 API 等扩展能力。
4. **模型可换**：所有模型调用必须经 SEP 自己的 ModelRelayClient（算力路由），
   不允许 agent 直连第三方模型平台。
5. **商用授权无摩擦**：平台对外转售，封装的 agent runtime 须无商业授权风险。

---

## 二、候选 Agent 概览

| | **OpenCode** | **Claude Code** | **Codex** |
|---|---|---|---|
| 主体 | 社区开源 | Anthropic 官方 | OpenAI 官方 |
| 授权 | MIT | 闭源 | 闭源 |
| 模型锁定 | ❌ 无锁定，支持 75+ provider | ⚠️ 官方仅 Claude；可通过 `ANTHROPIC_BASE_URL` 绕 | ⚠️ 基本锁 OpenAI 模型 |
| 无头调用方式 | `opencode run <prompt>` + `--attach <server>` | `claude -p <prompt>` / Python·TS Agent SDK | `codex exec <prompt>` |
| Skills(SKILL.md) | ✅ 原生支持 | ✅ SKILL.md 发明者，原生最强 | ✅ 有 skill 预设支持 |
| MCP 工具 | ✅ | ✅ | ✅ |
| 结构化输出 | ✅ `--format json` | ✅ SDK 支持 schema 约束 | ✅ |
| 自托管 | ✅ Docker 镜像 | ⚠️ 需要 Anthropic API Key，鉴权归 Anthropic | ⚠️ 需要 OpenAI API Key |

---

## 三、能力对比详解

### 3.1 无头/程序化调用

**OpenCode**  
```bash
opencode run --attach http://localhost:4096 \
  --dir /jobs/{id} --model <model> --format json \
  --dangerously-skip-permissions "<prompt>"
```
子进程模式，stdout 输出 JSONL，天然适合包一层 job 编排 API。
参考：`yaoruiquan/opencode-skiills-service` 已生产验证此模式。

**Claude Code**  
```bash
claude -p "<prompt>" --output-format json
```
`-p / --print` 即"无头模式"，底层由 Agent SDK 驱动。官方同时提供 Python 和 TypeScript
SDK，可直接把 agent loop 嵌入自有后端（无需 spawn 子进程）。  
[官方文档](https://code.claude.com/docs/en/headless) / [Agent SDK 指南](https://hidekazu-konishi.com/entry/claude_agent_sdk_complete_guide.html)

**Codex**  
```bash
codex exec "<prompt>" --model gpt-5.4 --approval-policy auto-edit
```
`codex exec` 专为非交互/CI 设计，不开 TUI，stdout 输出结果。  
[官方文档](https://developers.openai.com/codex/guides/autofix-ci)

三者在技术上均可无头调用，**功能无本质差距**。

### 3.2 Skills（SKILL.md）加载

SKILL.md 是 Anthropic 在 2025 年底发布并捐给 Linux 基金会的开放标准。核心机制
是**渐进式披露**：启动时只读 frontmatter（名称+描述，约 20 token/skill），
任务匹配时才加载全文。

- Claude Code：发明者，实现最完整，hook/路由机制最丰富。
- OpenCode：完整实现 SKILL.md 标准；`yaoruiquan/opencode-skiills-service`
  已生产使用（漏洞上报/公众号等 9 个 skill 验证）。
- Codex：通过 skill 预设支持，完整度略弱但功能可用。

**关键结论**：SKILL.md 是跨 agent 可移植的开放标准。今天为 OpenCode 写的
skills，明天可直接被 Claude Code 或 Codex 读取。**技能资产不被任何 agent 绑死**。

### 3.3 模型路由与国内模型支持

SEP 的硬约束：所有模型调用 → `ModelRelayClient`（new-api 兼容端点）
→ DeepSeek / 火山 / 千问等国内模型。

**OpenCode**：模型无关设计，`baseUrl` / `apiKey` 直接配，指向 SEP relay 即可。
无任何第三方鉴权摩擦。

**Claude Code**：官方只支持 Claude。用 `ANTHROPIC_BASE_URL` 可指向兼容端点
（DeepSeek 已提供 anthropic 格式兼容层：`https://api.deepseek.com/anthropic`），
但会触发内部 `custom3p` 企业配置校验逻辑，升级时有破坏风险。
[兼容端点文档](https://api-docs.deepseek.com/guides/anthropic_api) /
[custom3p 摩擦](https://apidog.com/blog/fix-invalid-custom3p-enterprise-config-claude-code)

**Codex**：深度绑定 OpenAI 模型体系，指向国内模型需要较重的代理层，可维护性差。

### 3.4 商用授权

| | OpenCode | Claude Code | Codex |
|---|---|---|---|
| 开源协议 | MIT | 闭源 | 闭源 |
| 可嵌入转售 | ✅ 无限制 | ⚠️ ToS 约束，嵌入商用产品对外转售存合规风险 | ⚠️ 同左 |
| 自托管无需向第三方付费 | ✅ | ❌ 需 Anthropic API Key | ❌ 需 OpenAI API Key |

SEP 要把 agent 能力包装成"硅基员工"卖给企业客户。把 Claude Code / Codex 这类
官方 CLI 嵌进转售产品，直接踩服务条款。MIT 协议的 OpenCode 无此风险。

---

## 四、综合评分

> 评分维度：✅ 完全满足 / 🔶 可用但有摩擦 / ❌ 不满足或风险高

| 维度 | OpenCode | Claude Code | Codex |
|---|---|---|---|
| 无头可调用 | ✅ | ✅ | ✅ |
| Skills 支持 | ✅ | ✅(最强) | 🔶 |
| MCP 工具 | ✅ | ✅ | ✅ |
| 模型自由度 | ✅ | 🔶 | ❌ |
| 国内模型路由 | ✅ | 🔶(custom3p 风险) | ❌ |
| 接 SEP relay | ✅ 直接配 | 🔶 需绕行 | ❌ |
| 商用授权 | ✅ MIT | ❌ ToS 风险 | ❌ ToS 风险 |
| 自托管无依赖 | ✅ | ❌ | ❌ |
| 生产案例 | ✅ opencode-skiills-service | ✅ 广泛 | ✅ 广泛 |
| **综合** | **✅ 推荐** | **❌ 商用不可用** | **❌ 模型锁定** |

---

## 五、各 Agent 适用场景

| Agent | 推荐用于 | 不适合 |
|---|---|---|
| **OpenCode** | SEP 平台商用底座；国内模型；对外转售 | 需要 Claude 最新能力的内部研发工具 |
| **Claude Code** | 内部开发辅助；研究探索；Anthropic 生态内使用 | 商用转售；国内模型强依赖 |
| **Codex** | OpenAI 生态内的推理密集型任务；需要严谨逐步执行 | 模型灵活换用；国内部署 |

---

## 六、附：SKILL.md 可移植性说明

SKILL.md 已是**跨 agent 的行业开放标准**（Anthropic 捐 Linux 基金会，Claude Code /
OpenCode / Codex CLI 均读取）。这意味着：

- 今天按 SKILL.md 打包的每一个"硅基员工"技能，是**平台资产**，不是某个 agent 的私有能力。
- 未来若 OpenCode 停止维护，或有更强的开源 agent 出现，技能包无需重写。
- SEP 的 `Capability / CapabilityVersion` 数据模型可以直接存 SKILL.md 内容，
  `platform`/`type` 字段记 `opencode_skill`，日后换引擎只动 adapter 层。

---

*参考资料：*
- [OpenCode vs Claude Code vs Codex 2026 对比](https://nimbalyst.com/blog/claude-code-vs-codex-vs-opencode-definitive-comparison)
- [OpenCode 模型无关 MIT](https://www.morphllm.com/comparisons/opencode-vs-claude-code)
- [Claude Code 无头模式官方文档](https://code.claude.com/docs/en/headless)
- [Codex exec 非交互模式](https://developers.openai.com/codex/guides/autofix-ci)
- [DeepSeek Anthropic 兼容 API](https://api-docs.deepseek.com/guides/anthropic_api)
- [Claude Code custom3p 配置问题](https://apidog.com/blog/fix-invalid-custom3p-enterprise-config-claude-code)
- [SKILL.md 标准解析](https://aishwaryasrinivasan.substack.com/i/206278498/index)
