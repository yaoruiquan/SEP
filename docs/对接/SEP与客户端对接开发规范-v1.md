# SEP 与 sep-client 对接开发规范 v1

> 状态：联调前基线，2026-08-24
>
> 适用对象：SEP（云端控制面）后端开发者、`/Users/yao/LLM/sep-client` Electron 客户端开发者、联调与测试人员。
>
> 权威顺序：用户已确认的产品边界 > 本文标注的当前代码契约 > 当前代码实现 > 旧版设计文档。旧文档中的 `EmployeeInstance`、云端任务执行、ZIP-only 分发等概念不能直接作为新功能契约。

## 1. 目标与非目标

SEP 与客户端组成一个控制面/执行面的系统：

- SEP 负责账号、企业与成员、订阅（雇佣关系）、员工与技能审核、版本选择、员工包引用、模型网关、用量和平台审计。
- `sep-client` 负责本机工作区、任务队列、计划确认、本地文件、工具审批、Pi agent 运行时和本地运行历史。
- 所有模型请求必须经过 SEP 的 `/gateway/v1/chat/completions`，客户端不得保存 `SUB2API_API_KEY` 或任何上游模型密钥。
- 普通任务正文、本地文件和任务结果默认只留在客户端，不自动回传 SEP。SEP 当前可靠记录的是企业、成员、订阅、模型和网关用量维度的数据。

本文不定义云端任务中心，也不把 `ConversationSession` 伪装成客户端任务。若以后需要企业查看任务，必须另行设计 `Task`/`TaskRun` API、隐私授权、保留期和结果存储。

## 2. 总体架构与数据流

```text
用户
  │
  ▼
sep-client (Electron renderer)
  │ IPC
  ▼
sep-client main process
  ├─ safeStorage: refresh token / 账号元数据
  ├─ SubscriptionRuntime: 员工包、技能、版本锁定、隔离目录
  ├─ TaskManager: 本地计划、队列、暂停/取消/恢复、运行记录
  ├─ ApprovalBroker: 本地工具审批
  └─ Pi agent ── HTTPS Bearer client-employment JWT ──► SEP
                                                        ├─ 授权、余额、模型白名单
                                                        ├─ sub2api 模型转发
                                                        └─ 用量、成本、审计
```

### 2.1 责任边界

| 能力 | SEP | sep-client |
|---|---|---|
| 登录、设备、成员身份 | 权威签发与吊销 | safeStorage 保存 refresh token，内存保存 access token |
| 员工目录 | 返回当前成员被授权且订阅 ACTIVE 的订阅 | 展示、选择、缓存 |
| 员工包 | 发布元数据、`packageRef`、SHA-256、授权校验 | 下载/安装/缓存、manifest 校验、隔离运行时、回滚 |
| 技能 | Markdown、版本、企业/平台审核、订阅选择 | 预览已授权内容、同步已生效版本到运行时 |
| 模型 | sub2api 转发、模型启用状态、余额与计量 | 只传模型 ID，不持有模型密钥 |
| 知识库 | 原文、分块、授权、检索、搜索日志 | 按确认后的运行策略调用检索并注入最小上下文 |
| 任务 | 可提供不执行的云端计划预览（过渡接口） | 计划确认、实际执行、工具审批、任务历史 |
| 审计 | 网关与平台/企业操作审计 | 本地诊断和安装失败，可选上报摘要 |

## 3. 统一术语与 ID 规则

| 术语 | 含义 | 客户端字段建议 |
|---|---|---|
| `enterpriseId` | 企业租户 ID | `ownerEnterpriseId` |
| `memberId` | 当前用户在企业中的成员记录 ID | `memberId` |
| `employeeId` | 平台数字员工模板 ID | `template.id` / `employeeId` |
| `subscriptionId` | 企业对某员工的订阅/雇佣关系 ID，也是客户端运行时主键 | `subscriptionId` |
| `capabilityId` | 员工绑定的能力 ID | `capabilityId` |
| `skillVersionId` | 某能力的一份 Markdown 技能版本 ID | `skillVersionId` |
| `templateVersion` | 订阅创建时锁定的员工模板版本 | `templateVersion` |
| `package.version` | 员工包版本，正式运行时必须与订阅锁定版本一致 | `packageVersion` |
| `employmentToken` | 短期 `client-employment` JWT，仅用于网关 | 不落盘 |
| `accessToken` | 普通短期用户 JWT，用于普通 JWT API | 仅内存 |
| `refreshToken` | 设备绑定的长期客户端 JWT | safeStorage |

客户端代码仍大量使用 `instanceId`/`employeeInstanceId`。这只是历史命名，不是新的后端实体。新代码统一迁移为 `subscriptionId`；SEP 不为旧语义长期维护双字段。

## 4. 环境与 API 基线

- 本地 SEP 后端默认：`http://localhost:3001`（以当前启动配置为准）。
- 客户端通过 `SEP_API_BASE_URL` 配置后端地址，不能把地址硬编码到 renderer。
- 生产必须使用 HTTPS。
- 普通 JSON API 的错误由 NestJS 返回，当前项目未承诺统一 `code` 字段。客户端至少按 HTTP 状态处理，并保留 `message`；建议 SEP 后续补稳定错误结构：`{ code, message, requestId, details? }`。
- 需要幂等的客户端动作（安装、选择版本、刷新、重试）由客户端使用本地操作 ID 去重；当前服务端没有通用 `Idempotency-Key` 契约。

## 5. 身份认证与会话

### 5.1 登录

`POST /client/auth/login`

请求：

```json
{
  "email": "member@example.com",
  "password": "***",
  "fingerprint": "stable-device-fingerprint",
  "platform": "darwin",
  "clientVersion": "0.1.0"
}
```

当前成功响应：

```json
{
  "accessToken": "<jwt>",
  "refreshToken": "<jwt>",
  "user": { "id": "usr_1", "email": "member@example.com", "name": "成员", "role": "USER" },
  "enterprise": { "id": "ent_1", "name": "示例企业" },
  "devices": [
    { "id": "dev_1", "fingerprint": "stable-device-fingerprint", "platform": "darwin", "lastSeenAt": "2026-08-24T10:00:00.000Z" }
  ]
}
```

当前响应没有稳定的 `expiresIn`，但客户端 `AuthSessionManager` 依赖它并会兜底一小时。SEP P0 应补 `accessTokenExpiresIn`（秒）和 `refreshTokenExpiresIn`（秒），客户端不得依赖本地猜测。

### 5.2 普通 access token 刷新（P0，当前缺口）

当前只有 `POST /client/auth/token`，它是“换雇佣令牌”，不是普通 access token refresh。SEP 应新增：

`POST /client/auth/refresh`

```json
{ "refreshToken": "<client-refresh-jwt>" }
```

建议响应：

```json
{
  "accessToken": "<jwt>",
  "accessTokenExpiresIn": 3600,
  "user": { "id": "usr_1", "email": "member@example.com", "name": "成员", "role": "USER" },
  "enterprise": { "id": "ent_1", "name": "示例企业" }
}
```

刷新时必须重新检查 refresh token 类型、设备存在且未吊销、用户仍有效。刷新失败返回 401，客户端清理内存 token 并回到登录页。

### 5.3 客户端存储规则

- `refreshToken`：Electron `safeStorage`；不可进入 renderer、日志、任务正文或错误上报。
- `accessToken`：主进程内存；不可写 `localStorage`。
- `employmentToken`：主进程内存，按 `subscriptionId` 缓存；不得落盘。
- 注销/设备吊销后清除本地 token 和运行时令牌。当前 SEP 没有客户端专用 logout/revoke endpoint，建议补 `POST /client/auth/logout` 和设备吊销后的主动失效策略。

## 6. 授权员工目录

### 6.1 当前接口与必须修复的问题

当前接口：`GET /client/instances`，Bearer 普通 `accessToken`。

当前真实返回字段：

```json
[
  {
    "id": "sub_1",
    "name": "电商运营员工",
    "status": "ACTIVE",
    "templateVersion": "1.2.0",
    "template": { "id": "emp_1", "name": "电商运营员工", "avatar": null },
    "department": null
  }
]
```

其中 `id` 实际是 `subscriptionId`。当前实现只按企业和 ACTIVE 查询，没有按当前成员的 `EmployeeGrant`（直接授权/部门授权、未过期）过滤，这是 P0 越权风险。客户端不能用列表结果作为唯一授权依据，网关仍会再次校验。

当前客户端期待 `allowedModels`，SEP 列表没有返回，导致客户端不能可靠选择模型。P0 应补充：

```json
{
  "subscriptionId": "sub_1",
  "employeeId": "emp_1",
  "name": "电商运营员工",
  "status": "ACTIVE",
  "templateVersion": "1.2.0",
  "template": { "id": "emp_1", "name": "电商运营员工", "avatar": null },
  "department": null,
  "allowedModels": ["gpt-4o-mini"],
  "upgradeAvailable": false
}
```

建议新增语义清晰的 `GET /client/subscriptions`，旧 `/client/instances` 短期 兼容并标记 deprecated。无授权、非 ACTIVE、授权过期的订阅不得出现在列表中；订阅暂停/终止或授权撤销后，下一次刷新应消失。

### 6.2 客户端缓存

- 仅缓存非秘密元数据和已安装包/技能摘要。
- 每次登录、窗口回到前台、收到网关 403/404 后刷新目录。
- `lastSelectedSubscriptionId` 可存本地；不要再新增 `lastSelectedInstanceId`。
- 目录缓存不能绕过网关授权，也不能在订阅失效后继续执行。

## 7. 雇佣令牌与模型网关

### 7.1 换取雇佣令牌

当前接口：`POST /client/auth/token`。

当前请求（注意是 `subscriptionId`，不是 `instanceId`）：

```json
{ "refreshToken": "<client-refresh-jwt>", "subscriptionId": "sub_1" }
```

当前响应：

```json
{
  "employmentToken": "<short-lived-jwt>",
  "expiresIn": 900,
  "employment": { "id": "sub_1", "name": "电商运营员工", "templateId": "emp_1", "status": "ACTIVE" }
}
```

JWT claim：`sub`（userId）、`enterpriseId`、`subscriptionId`、`memberId`、`type: "client-employment"`。

客户端当前仍解析 `instanceToken`/`instance`，必须迁移，否则交换必然失败。令牌刷新提前量建议为有效期的三分之一且不少于 60 秒；并发刷新必须合并为一个请求。

### 7.2 调用网关

`POST /gateway/v1/chat/completions`

请求头：`Authorization: Bearer <employmentToken>`、`Content-Type: application/json`。

请求体遵循 OpenAI-compatible 形状：

```json
{
  "model": "gpt-4o-mini",
  "messages": [
    { "role": "system", "content": "员工技能与任务上下文" },
    { "role": "user", "content": "用户任务" }
  ],
  "temperature": 0.2,
  "max_tokens": 4000,
  "stream": true,
  "tools": []
}
```

网关每次请求实时检查：雇佣令牌、订阅 ACTIVE、成员授权、企业余额、模型 enabled。成功后经 sub2api 转发并记录 token/cost。客户端只发送模型 ID 和消息，不发送任何上游密钥。

状态处理：401 重新换雇佣令牌后仅重试一次；403 显示“员工授权/订阅/余额/模型不可用”，刷新目录但不要无限重试；429 按 `Retry-After`（若存在）退避；5xx/网络错误有限次指数退避。流式响应中断时，任务标记可恢复/失败，不能伪造完成。

## 8. 员工包分发、安装与版本锁定

### 8.1 查询包信息

`GET /enterprise/subscriptions/:subscriptionId/package`，普通 Bearer access token。

当前响应：

```json
{
  "version": "1.2.0",
  "packageRef": { "type": "npm", "spec": "@sep/employee-commerce@1.2.0" },
  "zipAvailable": false,
  "sha256": null
}
```

当前 `getForSubscription()` 取员工包创建时间最新版本，没有使用 `Subscription.templateVersion`。这会让订阅锁定旧版本却拿到新包，是 P0 必修；修复后必须按 `employeeId + subscription.templateVersion` 精确查找，找不到应返回明确错误（例如 409/404），而不是静默升级。

### 8.2 正式分发策略

- 首选 `packageRef.type = npm` 或 `git`。
- npm 必须使用精确版本（例如 `@scope/name@1.2.0`），禁止 `latest`、`^1`、`*`。
- git 必须使用不可变 commit/完整可验证引用，禁止浮动 branch/tag 作为生产安装目标。
- ZIP 是兼容/兜底通道；packageRef-only 包没有 ZIP 下载能力，客户端不要为新流程依赖 ZIP。
- 客户端安装后记录 `subscriptionId`、`employeeId`、`packageVersion`、`packageRef`、内容哈希、安装时间和安装器版本。

### 8.3 客户端安装状态机

```text
not_installed -> resolving -> downloading/installing -> verifying -> ready
                                      └───────────────> failed
ready -> update_available -> installing_new -> verifying -> ready
ready -> rollback_previous (校验失败/启动失败)
```

安装目录按企业和订阅隔离，例如 `runtime/<enterpriseId>/<subscriptionId>/<packageVersion>`；禁止直接使用用户全局 `~/.pi` 作为员工技能来源。安装前校验 `packageRef` 与服务端版本，ZIP 兼容路径校验 `sha256`。技能、系统提示词和 agents 文件通过 Pi SDK 的 `ResourceLoader` override 注入，不能依赖全局配置。

## 9. 技能版本与 Markdown 预览

### 9.1 成员可读接口

`GET /enterprise/employees/:employeeId/skills`：需普通 Bearer access token，必须对员工有有效授权。

返回结构：

```json
{
  "subscriptionId": "sub_1",
  "canManage": false,
  "skills": [
    {
      "capability": { "id": "cap_1", "name": "商品分析", "description": "...", "type": "SKILL" },
      "currentVersion": {
        "id": "sv_1", "capabilityId": "cap_1", "scope": "PLATFORM",
        "enterpriseId": null, "parentVersionId": null, "sourceVersionId": null,
        "version": "1.0.0", "changeSummary": "初版", "status": "PLATFORM_APPROVED",
        "createdAt": "2026-08-24T10:00:00.000Z", "updatedAt": "2026-08-24T10:00:00.000Z"
      },
      "versions": [],
      "upgradeAvailable": false
    }
  ]
}
```

`GET /enterprise/skill-versions/:id/preview` 返回版本摘要、`capability` 和 `content` Markdown 正文。客户端应按正文显示，不执行其中的脚本/链接；渲染器需限制危险 HTML、外链和过大正文，并保留版本号、状态、更新时间和来源信息。

### 9.2 审核与生效边界

企业创建/编辑/内部审核/提交平台审核/平台审核/订阅选择均由 SEP 管理：

- `POST /enterprise/subscriptions/:subscriptionId/skill-versions`
- `PATCH /enterprise/skill-versions/:id`
- `POST /enterprise/skill-versions/:id/submit-review`
- `POST /enterprise/skill-versions/:id/review`
- `POST /enterprise/skill-versions/:id/submit-platform-review`
- `POST /enterprise/subscriptions/:subscriptionId/skills/:capabilityId/select-version`

客户端第一期只读：预览当前已授权版本，并同步已选且审核通过版本到员工运行时。客户端不能直接改技能版本，也不能把草稿/待审核正文注入生产运行时。版本更新顺序是“企业审核通过 -> 平台审核通过 -> 企业选择 -> 客户端刷新并安装/组装”。

## 10. 企业知识库

### 10.1 云端边界

知识库原文、文档、分块、向量和授权均由 SEP 管理；默认不下载到客户端本地员工目录。客户端可查询某订阅的知识库授权摘要：

`GET /knowledge-bases/grants/by-subscription/:subscriptionId`

当前返回包含授权记录和 `knowledgeBase: { id, name }`。此接口当前使用普通 JWT，访问者必须属于订阅企业；客户端仍应只展示与当前订阅相关的结果。

### 10.2 检索

`POST /knowledge-bases/search`

```json
{
  "query": "平台退货政策",
  "subscriptionId": "sub_1",
  "topK": 5,
  "scoreThreshold": 0.5,
  "strategy": "auto"
}
```

响应：

```json
{
  "query": "平台退货政策",
  "subscriptionId": "sub_1",
  "strategy": "lexical",
  "durationMs": 42,
  "count": 1,
  "results": [
    { "chunkId": "chunk_1", "knowledgeBaseId": "kb_1", "source": "售后政策.md", "score": 0.91, "content": "..." }
  ]
}
```

服务端会再次校验订阅属于当前企业，并按直接/部门知识库授权过滤。嵌入服务不可用时 `auto`/`hybrid` 会降级词法检索；客户端应把 `strategy` 当实际结果使用，不假设一定是向量检索。

### 10.3 待产品确认的运行方式

推荐第一期：用户在客户端确认任务后，由客户端以当前订阅调用 search，把最小必要片段注入 Pi system/user context；不自动上传本地文件，不把整个任务正文或检索结果回传到任务中心。若要“模型自行决定何时检索”，需另行定义 Pi tool 与网关/知识库权限，不能依赖关键词匹配。

## 11. 任务计划、执行和工具审批

### 11.1 当前云端计划预览（过渡能力）

`POST /task-plans/preview` 使用普通 access token，调用真实 sub2api 模型，返回 `awaiting_confirmation` 计划，不执行任务。请求结构：

```json
{ "objective": "分析本月商品退货原因", "employeeIds": ["emp_1"] }
```

服务端返回计划、步骤、员工、能力、依赖和 `planner: { type: "llm", model: "..." }`。这证明当前不是关键词匹配；但服务使用 `SubscriptionService.findAll()`，而该方法当前只按企业查询，授权过滤需要 P0 修复后才能作为客户端正式目录来源。

### 11.2 正式职责

客户端拥有：计划展示与编辑、用户确认、任务入队、工作区锁、暂停/取消/恢复、Pi 执行、工具审批、运行记录。SEP 不执行客户端本地工具，不接收本地路径对应的文件内容。

规划位置需产品拍板：推荐把规划最终放在客户端，通过 SEP 网关调用规划模型并在客户端按授权目录校验；现有 `/task-plans/preview` 可作为过渡只读接口，不能扩展成云端任务执行中心。

### 11.3 Pi 运行时要求

当前 `PiCodingAgentAdapter` 已有网关请求归一化、动态 Authorization header、事件映射和敏感信息清洗，但 `DefaultResourceLoader` 使用 `noSkills: true`/`noContextFiles: true`，因此当前运行并未真正加载员工包技能。客户端 P0 必须完成：

1. 安装并校验订阅锁定的员工包。
2. 从技能 API 同步当前已生效版本正文到订阅隔离目录。
3. 用 `skillsOverride`、`systemPromptOverride`、`agentsFilesOverride` 或等价 SDK 注入口加载这些内容。
4. 对未知工具默认拒绝，高风险工具通过 `ApprovalBroker` 请求用户确认。

## 12. 使用量、审计与隐私

- 网关调用自然产生模型、订阅、成员、企业、token、成本和请求状态用量。
- 技能审核、版本选择、包安装元数据属于平台/企业审计范围。
- 客户端可上报安装失败、运行时版本、错误类型、耗时等诊断摘要；必须脱敏并取得产品同意。
- 默认不上报任务标题/正文、本地路径、文件内容、完整模型 prompt/response。日志中不得出现 Bearer token、refresh token、API key、密码或 Cookie。

## 13. 版本兼容与错误处理

### 13.1 P0 服务端改造（SEP 本轮已完成）

1. 已新增 `/client/auth/refresh`，登录响应已补充 access/refresh expires 字段。
2. 已新增 `/client/subscriptions`，按当前成员有效 `EmployeeGrant` 过滤，返回 `subscriptionId`、`employeeId`、`allowedModels`、`upgradeAvailable`。
3. 已保留 `/client/instances` 兼容入口，两条路径共用新订阅语义。
4. `/client/auth/token` 已在签发前校验当前成员有效授权，并统一使用 `subscriptionId`、`employmentToken`、`employment`。
5. `getForSubscription()` 已按 `Subscription.templateVersion` 精确返回包；锁定版本缺包时返回 404。
6. 网关已按平台启用模型和企业白名单共同收窄模型；目录返回值与实际网关白名单一致。
7. 任务规划候选已按当前成员有效 `EmployeeGrant` 过滤。

客户端仍需完成字段迁移、普通 access refresh 接入、员工包安装/隔离、技能运行时加载和联调矩阵；技能、知识库正文及企业审核流程本轮未改动。

### 13.2 客户端 P0 改造

1. 全代码字段迁移：`instanceId`/`employeeInstanceId` -> `subscriptionId`。
2. `AuthSessionManager` 接入普通 access refresh；重启后从 safeStorage 恢复会话而不是强制重新登录。
3. `InstanceTokenManager` 改名/改契约为 `EmploymentTokenManager`，请求 `subscriptionId`，解析 `employmentToken`。
4. 实现订阅目录、`allowedModels` 选择与撤销处理。
5. 实现包查询、精确版本安装、哈希校验、隔离目录、失败回滚。
6. 实现技能列表、Markdown 预览、当前生效版本组装到 Pi ResourceLoader。
7. 保持 renderer 只能走 contextBridge，所有 SEP 请求和秘密仅在 main process。

## 14. 联调顺序与验收矩阵

按依赖顺序联调：

1. 登录 -> 普通 access refresh -> 设备吊销后刷新失败。
2. 企业给成员直接授权/部门授权 -> 订阅目录只出现授权且 ACTIVE 的订阅。
3. `subscriptionId` 换 employment token -> 网关调用成功；暂停订阅/撤销授权后返回 401/403。
4. 查询包 -> 返回与 `templateVersion` 相同的版本；安装、SHA 校验和运行时隔离成功。
5. 查询技能 -> 预览 Markdown；企业草稿/待审核版本不能进入运行时；选择新审核版本后刷新可见。
6. 查询知识库授权 -> search 只返回当前订阅被授权知识库的分块；无授权返回空结果或明确禁止，不泄漏他企数据。
7. 任务计划 -> 展示并等待确认；确认后只在客户端执行；工具审批拒绝后任务可观察地暂停/失败。
8. 网关流式中断、余额不足、模型禁用、令牌过期、网络重试均有确定状态和有限重试。
9. 双企业、双成员、直接授权和部门授权的越权测试必须覆盖目录、包、技能、知识库、网关五条链路。

## 15. 需要产品拍板的问题

以下问题会改变 API 或客户端架构，建议在开始 P0 实现前确认：

1. 是否接受 `GET /client/subscriptions` 新路径，旧 `/client/instances` 只保留一个过渡周期？推荐接受。
2. 任务规划最终放客户端还是 SEP？推荐客户端规划、SEP 网关提供模型；`/task-plans/preview` 仅作为过渡。
3. 客户端是否在用户确认任务后自动调用企业知识库 RAG？推荐“确认后检索、最小片段注入”，不默认上传本地文件。
4. 已安装员工是否允许离线继续执行？推荐不允许离线模型执行；可离线浏览已缓存技能和包元数据，令牌刷新与模型调用必须联网。
5. 员工包正式来源是否限定精确 npm 版本或 git commit？推荐是；ZIP 仅保留兼容兜底。
6. 是否建设企业任务中心并回传任务摘要/结果？推荐 MVP 不回传；如确定建设，需单独立项 Task/TaskRun、隐私同意、结果存储和保留期限。

## 16. 客户端提交物与完成定义

客户端完成对接的标准是：

- 所有网络请求集中在 Electron main process，renderer 无秘密。
- 订阅、员工模板、技能版本、包版本均使用正确 ID 和精确版本，不再出现 instance 语义混用。
- 账号重启可恢复、设备吊销可退出、授权撤销不能继续调用网关。
- 员工运行实际加载对应包和审核通过技能，而不是只调用通用模型。
- 本地任务全生命周期可追踪，工具审批默认拒绝未知工具。
- 联调矩阵全部通过，并附请求日志中的 requestId、HTTP 状态和脱敏结果；不提交 token、用户任务正文或本地文件。
