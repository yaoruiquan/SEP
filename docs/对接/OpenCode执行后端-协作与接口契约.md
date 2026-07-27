# OpenCode 硅基员工执行后端 —— 设计方案、协作方案与接口契约

> 日期：2026-07-21
> 状态：⚠️ **本文第 4 节接口契约与真实服务不符，实现时不要以本文为准**
> 相关：[ADR-0009 OpenCode 作为 SEP Agent 底座](../architecture/adr/0009-opencode-agent底座.md)、[agent-runtime 对比](./agent-runtime-对比.md)

> ## ⚠️ 2026-07-27 核对结论
>
> 对照真实服务 `yaoruiquan/opencode-skiills-service` 的 README 与 `backend/server.js`：
>
> | 本文第 4 节 | 真实服务 |
> |---|---|
> | `POST /v1/runs`（发起即执行） | `POST /jobs` → `POST /jobs/{id}/files` → `POST /jobs/{id}/run` 三步 |
> | `GET /v1/runs/{run_id}` | `GET /jobs/{id}` |
> | 输入放请求体 `input` 字段 | 输入以文件上传到 job 的 `input/` 目录 |
> | `Authorization: Bearer` 必须 | 服务端**无任何 API 鉴权** |
> | 返回 `usage`（标为"计费证据"） | **不返回任何 token 统计** |
> | 状态 `succeeded/failed/canceled/running` | `created/running/retrying/paused/succeeded/completed/failed/canceled` |
>
> `backend/src/modules/capability/adapters/opencode.adapter.ts` 实现的是**真实服务的
> `/jobs` 契约**，方向正确，勿按本文重写。该 adapter 的已知缺陷（状态值判断错误等）
> 记录在 `docs/status/development-status.md` 的「已知问题 > OpenCode 集成缺陷」。
>
> 本文第 5.1 节（管理端对接配置界面）、第 8 节（待确认问题）仍有参考价值。

## 0. 一句话

SEP 与 OpenCode 执行后端是**两个独立项目、两个独立仓库、两套独立部署**，
只通过一份 **HTTP 接口契约**连接。SEP Gateway 调用 OpenCode 后端的方式，与它
现在调用 Coze（api.coze.cn）的方式**同构**——OpenCode 后端就是"自己托管的 provider"。

---

## 1. 为什么是两个项目，不是一个

| 理由 | 说明 |
| --- | --- |
| 运行时异构 | SEP Gateway 是 TypeScript/Fastify 进程；OpenCode 后端是另一个运行时，需要自己的 server 进程、skills 目录、文件系统。无法共存于一个进程。 |
| 架构不变量 | SEP 规定 Gateway **不连 SEP 数据库**、所有模型调用**经 ModelRelayClient**。OpenCode 后端作为独立进程天然满足隔离。 |
| 分工物理边界 | 两个仓库 = 一人一仓，互不 clone、互不 merge 冲突、互不 review 阻塞。 |
| 可替换性 | 契约稳定后，OpenCode 后端未来可换实现（甚至换 agent），SEP 侧零改动。 |

---

## 2. 系统拓扑

```text
                         SEP （项目 A，本仓库）
   ┌─────────────────────────────────────────────────────┐
   │  Platform API ────────────── Gateway                  │
   │  租用/绑定/租户/授权            │                        │
   │                               │  HTTP（本文契约 = 边界缝）│
   └───────────────────────────────┼────────────────────────┘
                                   │
                                   ▼
              ┌──────────────────────────────────────┐
              │  OpenCode Skills Service （项目 B）      │
              │  = opencode-skills-service 剥离后的内核 │
              │    opencode run + skills 目录 + job API │
              └──────────────────┬───────────────────┘
                                 │ 模型调用（base_url 指向 SEP relay）
                                 ▼
              ┌──────────────────────────────────────┐
              │  SEP ModelRelay → new-api → 国内模型     │
              │  DeepSeek / 火山 / 千问                   │
              └──────────────────────────────────────┘
```

关键：OpenCode 的模型调用 `base_url` 指向 **SEP 的 relay**，不直连 DeepSeek。
算力计费、余额监控、渠道路由全部落到平台，符合"不让用户绕过平台拿 Key"。

---

## 3. 项目 B（OpenCode 后端）要做的剥离

以 `opencode-skills-service` 为起点，**只留内核，砍掉业务外壳**：

| 现有部分 | 处置 | 原因 |
| --- | --- | --- |
| `opencode-server/` + skills 目录 | ✅ 保留 | 核心执行引擎 |
| `backend/server.js` `executor.js` `jobs-crud.js` | ✅ 保留并稳定为对外契约 | job API 已存在 |
| Chrome DevTools MCP + Docker Chrome ×4 | ❌ 移除 | 域特定（漏洞上报专用） |
| `templates.js` + phase1/phase2 模板 | ❌ 移除 | 换业务即废，改为按 skill 名动态调度 |
| `human-input.js` / SSE / push | ❌ 移除 | UX，机器对机器调用不需要 |
| Vue 前端控制台 | ❌ 移除 | 平台侧统一出 UI |
| `adapters/` deterministic legacy | ❌ 移除 | 已默认关闭 |
| 模型直连 DeepSeek 的配置 | 🔧 改为指向 SEP relay | 见第 2 节 |
| 无鉴权 | 🔧 新增：只认 Gateway 来的调用（共享密钥/mTLS） | 生产安全 |

剥离后大约只剩：OpenCode server + skills 目录 + 一个"收 job → 跑 → 回结果"的薄 HTTP 层。

---

## 4. 接口契约（边界缝）—— 两人第一件要一起冻结的东西

**方向**：SEP Gateway（客户端）→ OpenCode 后端（服务端）。全部 SEP 主动发起。

### 4.1 鉴权

- 所有请求带 `Authorization: Bearer <SHARED_GATEWAY_TOKEN>`（MVP）；生产考虑 mTLS。
- OpenCode 后端拒绝任何无有效 token 的请求，不对公网裸奔。

### 4.2 发起执行 `POST /v1/runs`

请求：

```jsonc
{
  "run_id": "sep-inv-<uuid>",        // SEP invocation id，幂等键
  "skill": "md2wechat",              // skill 名（见第 5 节 skill 来源）
  "skill_version": "1.2.0",          // 精确版本，对应 SEP CapabilityVersion
  "input": { /* 任务输入，形状由 skill 的 input schema 决定 */ },
  "interaction_mode": "async_poll",  // sync | async_poll（先不做 stream）
  "model": "deepseek-chat",          // SEP 决定用哪个模型（走 relay 时的模型名）
  "max_duration_ms": 600000,
  "callback_url": "https://gateway.sep/internal/opencode/callback" // 可选，async 完成回调
}
```

响应（`202 Accepted`）：

```jsonc
{ "run_id": "sep-inv-<uuid>", "status": "running", "provider_request_id": "oc-<uuid>" }
```

- **幂等**：同 `run_id` 重复 POST 返回同一 run，不重复执行（对齐 SEP 的重放语义）。

### 4.3 查询状态 `GET /v1/runs/{run_id}`

```jsonc
{
  "run_id": "sep-inv-<uuid>",
  "status": "running | succeeded | failed | canceled",
  "output": { /* status=succeeded 时存在，形状由 skill output schema 决定 */ },
  "error": { "code": "SKILL_TIMEOUT", "message": "..." },   // status=failed 时
  "usage": {                          // 计费证据，对齐 relay usage
    "model": "deepseek-chat",
    "input_tokens": 1234,
    "output_tokens": 567,
    "usage_incomplete": false         // 无法精确统计时置 true（Coze 已有先例）
  },
  "started_at": "2026-07-21T...",
  "finished_at": "2026-07-21T..."
}
```

### 4.4 取产物 `GET /v1/runs/{run_id}/outputs` （可选，产物是文件时）

返回文件清单 + 各文件下载地址；纯 JSON 结果可直接放 4.3 的 `output`。

### 4.5 取消 `POST /v1/runs/{run_id}/cancel`

### 4.6 健康检查 `GET /health`

```jsonc
{ "status": "ok", "skills": ["md2wechat", "..."], "opencode": "reachable" }
```

### 4.7 错误码约定

| code | 含义 |
| --- | --- |
| `SKILL_NOT_FOUND` | 未安装该 skill/版本 |
| `SKILL_TIMEOUT` | 超过 `max_duration_ms` |
| `MODEL_RELAY_ERROR` | 上游模型/relay 失败 |
| `INVALID_INPUT` | input 不满足 skill schema |
| `INTERNAL` | 其它 |

> 该契约与 Coze adapter 的 `invoke/getStatus/status/usage/executionId` 结构刻意同构，
> 便于 SEP 侧 `opencode-skill-adapter.ts` 直接复用 `coze-workflow-adapter.ts` 的骨架。

---

## 5. skill 来源 ——【已拍板】

**MVP 走简单版**：skill 预装在 OpenCode 后端（项目 B 自己管），SEP 按名字+版本引用。
**版本号由项目 B 分配**，SEP 侧 `CapabilityVersion.runtimeEntry` 记 skill 名，
`manifest.runtime.skill_version` 记项目 B 分配的 semver。

| 阶段 | 做法 |
| --- | --- |
| **MVP（当前）** | skill 预装在 OpenCode 后端；SEP 在 Capability manifest 里填 skill 名+版本；无需打包上传 |
| **正式版（后续）** | SEP 成为 skill 唯一真源，skill 打包存 SEP 对象存储，调用时 Gateway 把包推给后端临时落地 |

> 正式版迁移时 SEP 侧只动 adapter 层（推包逻辑），其余治理闭环不变。

---

## 5.1 SEP 管理端：OpenCode 服务对接配置界面 ——【新增需求】

平台管理员可在管理控制台配置"当前接入的 OpenCode 后端"，不需要重新部署或改代码。
配置项存入 SEP 的 `ServiceConfig`（或 `SecretProfile`）表，Gateway 启动时读取。

**管理端配置页面（`/admin/settings/opencode`）应包含：**

| 字段 | 说明 |
| --- | --- |
| 服务端点 (base_url) | `http://opencode-service:4100`，Gateway adapter 发请求的目标 |
| 鉴权 Token | Gateway 调 OpenCode 后端时带的 `Bearer <token>`，存 SecretProfile（不明文展示） |
| 超时（ms） | 默认 600000，可覆盖 |
| 健康检查状态 | 页面内"测试连接"按钮，调 `GET /health`，显示 ok / error + skills 列表 |
| 已接入 Skill 列表 | 来自 `GET /health` 的 `skills` 字段，只读展示，让运营知道后端装了哪些 skill |

**前端对应的组件/位置：** 管理端 Settings 模块，新增 `OpenCodeSettingsScreen`，
路径 `/admin/settings/opencode`，左侧导航加入口（仅 platform_admin 可见）。

**后端需要：**
- `GET/PUT /api/admin/settings/opencode`（仅 platform_admin + platform aud）
- SecretProfile 存 token，base_url 存普通配置字段
- Gateway 读取时走已有的 SecretProfile 解密路径（与 Coze PAT 相同机制）

---

## 6. 分工与并行

| 轨 | 负责人 | 范围（写入边界） | 依赖 |
| --- | --- | --- | --- |
| A · OpenCode 后端 | 同事（项目 B 仓库） | 剥离服务、实现第 4 节契约、模型指向 relay、加鉴权 | 只依赖本文契约 |
| B · SEP 接入 | 你（本仓库） | ①`packages/contracts` 加 `opencode_skill` runtime kind；②Gateway `opencode-skill-adapter.ts`（照抄 coze 骨架）；③Prisma 迁移加能力类型；④治理闭环（租用/绑定/租户隔离/provider_execution 租约） | 只依赖本文契约 |

**并行前提**：第 4 节 API 形状先冻结（哪怕先用 mock）。
- SEP 侧对着 mock 后端写 adapter；
- 项目 B 对着契约做真实服务；
- 最后联调。

这与 SEP 做 Coze 的套路一致（T-027 后端 + T-028 前端并行）。

---

## 7. 联调顺序（建议）

1. 双方评审并**冻结第 4 节契约**（本文接受 = 冻结）。
2. 项目 B 先出 `GET /health` + `POST /v1/runs`（sync 模式，单个 hello-world skill）。
3. SEP 侧 adapter 打通 sync 调用 → 一次成功 invocation 落库。
4. 加 `async_poll` + 状态轮询 + usage 证据。
5. 模型切到 relay，验证计费/监控链路。
6. 接一个真实业务 skill（如 md2wechat）跑端到端。

---

## 8. 待确认问题

| # | 问题 | 状态 |
| --- | --- | --- |
| 1 | 鉴权用共享 token 还是 mTLS？ | ✅ **MVP 用共享 token**（Bearer），存 SecretProfile |
| 2 | 产物是文件时，走 4.4 下载还是对象存储 URI？ | ⬜ 待定，先按 JSON output 处理，文件场景后续补 |
| 3 | `async_poll` 轮询由 SEP `provider-execution-worker` 负责？ | ✅ **是**，对齐 Coze 现有轮询机制 |
| 4 | skill 版本号谁分配？ | ✅ **项目 B（OpenCode 后端）分配**，SEP manifest 里填写 |
| 5 | OpenCode 后端部署位置？relay 可达？ | ⬜ 待定，需确认内网可访问性 |
| 6 | skill 来源 MVP 简单版是否拍板？ | ✅ **已拍板**，见第 5 节 |
