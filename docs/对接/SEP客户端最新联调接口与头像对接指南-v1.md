# SEP 客户端最新联调接口与头像对接指南

> **文档版本**：v1.1
> **更新时间**：2026-09-20
> **适用对象**：`sep-client` Electron 客户端开发者、客户端测试人员
> **联调环境**：`https://sep-dev.longdaoSEP.cn`
> **本次重点**：客户端订阅/运行时新接口、员工头像 `avatarAsset` 契约、联调环境验收信息

本文是当前联调环境的客户端接入基线。接口路径、字段名称和鉴权方式以本文及当前后端实现为准；旧版本中的 `instanceId`、`instanceToken`、旧的 `/gateway/chat` 路径均不再作为新代码的实现依据。

---

## 1. 联调环境信息

### 1.1 地址配置

| 用途 | 地址 |
|---|---|
| HTTP API Base URL | `https://sep-dev.longdaoSEP.cn/api` |
| 模型网关 Base URL | `https://sep-dev.longdaoSEP.cn/api/gateway/v1` |
| 通知 WebSocket | `wss://sep-dev.longdaoSEP.cn/ws/notifications` |
| 员工状态 WebSocket | `wss://sep-dev.longdaoSEP.cn/ws/employee-status` |
| Swagger | `https://sep-dev.longdaoSEP.cn/api/docs` |
| 存活检查 | `GET https://sep-dev.longdaoSEP.cn/api/health` |
| 就绪检查 | `GET https://sep-dev.longdaoSEP.cn/api/health/ready` |

客户端建议配置为：

```bash
SEP_BASE_URL=https://sep-dev.longdaoSEP.cn/api
SEP_GATEWAY_URL=https://sep-dev.longdaoSEP.cn/api/gateway/v1
```

> `SEP_BASE_URL` 已包含 `/api`。接口调用时直接拼接 `/client/...`、`/enterprise/...`，不要重复拼接 `/api`。
>
> - 正确：`https://sep-dev.longdaoSEP.cn/api/client/subscriptions`
> - 错误：`https://sep-dev.longdaoSEP.cn/client/subscriptions`
> - 错误：`https://sep-dev.longdaoSEP.cn/api/api/client/subscriptions`

### 1.2 当前部署状态（2026-09-20）

| 组件 | 状态 | 说明 |
|---|---|---|
| `sep-dev-backend` | `healthy` | 当前联调后端已部署 |
| `sep-dev-web` | `healthy` | 静态头像资源随 Web 镜像发布 |
| `GET /api/health` | `200` | 返回 `{"status":"ok"}` |
| `GET /api/health/ready` | `200` | PostgreSQL、Redis、任务队列、知识库队列、sub2api、embedding 均为 `ok` |

本次部署未修改共享 PostgreSQL、Redis、Ollama 或 Caddy 配置。客户端开发者不需要接触这些基础设施地址，也不需要配置上游模型 API Key。

### 1.3 联调账号

联调账号由项目组单独提供。本文不记录密码、`accessToken` 或 `refreshToken`，请不要把这些敏感信息写入 Git、截图、Issue、任务正文或公共日志。

建议客户端使用独立且稳定的设备指纹，例如：

```text
sep-client-dev-<本机唯一标识>
```

同一台设备的 `fingerprint` 在登录、刷新 token 和后续联调过程中应保持不变。

---

## 2. 客户端职责与 token 规则

### 2.1 三类 token

| Token | 获取方式 | 默认有效期 | 用途 | 存储要求 |
|---|---|---:|---|---|
| `accessToken` | `POST /client/auth/login`、`POST /client/auth/refresh` | 1 小时 | 调用普通客户端 API，如订阅、运行时、组织目录 | 仅 Electron main 进程内存 |
| `refreshToken` | `POST /client/auth/login` | 30 天 | 刷新 `accessToken`、换取 `employmentToken` | Electron `safeStorage` 或同等级安全存储 |
| `employmentToken` | `POST /client/auth/token` | 默认 15 分钟 | 调用模型网关 | 仅 Electron main 进程内存，按 `subscriptionId` 缓存 |

禁止事项：

- renderer 不得直接请求 SEP API，也不得接触任何 token。
- 不得把 token 放入 URL、任务正文、错误上报、普通日志或截图。
- 不得在客户端保存或请求 `SUB2API_API_KEY`。
- 模型网关只接受 SEP 签发的 `employmentToken`，不要把普通 `accessToken` 直接用于网关。

### 2.2 推荐调用流程

```text
POST /client/auth/login
        ↓
GET /client/subscriptions
        ↓
选择 subscriptionId
        ↓
GET /client/subscriptions/:subscriptionId/runtime
        ↓
POST /client/auth/token
        ↓
POST /gateway/v1/chat/completions
```

应用回到前台、订阅安装前或网关返回 `401/403/404` 时，客户端应重新拉取订阅列表。并发刷新普通 token 或同一订阅的 employment token 时，应合并为一个请求。

---

## 3. 客户端认证接口

所有下文路径均相对于 `SEP_BASE_URL`。

### 3.1 登录并注册设备

```http
POST /client/auth/login
Content-Type: application/json
```

请求体：

```json
{
  "email": "client-dev@example.com",
  "password": "由项目组单独提供",
  "fingerprint": "sep-client-dev-macbook",
  "platform": "darwin",
  "clientVersion": "0.1.0"
}
```

字段：

| 字段 | 类型 | 必填 | 说明 |
|---|---|---|---|
| `email` | string | 是 | 联调账号邮箱 |
| `password` | string | 是 | 联调账号密码 |
| `fingerprint` | string | 是 | 1-256 字符；同一设备保持稳定 |
| `platform` | string | 是 | 推荐 `darwin`、`win32`、`linux` |
| `clientVersion` | string | 否 | 当前客户端版本 |

成功响应 `200`：

```json
{
  "accessToken": "<jwt>",
  "refreshToken": "<client-refresh-jwt>",
  "accessTokenExpiresIn": 3600,
  "refreshTokenExpiresIn": 2592000,
  "user": {
    "id": "user_id",
    "email": "client-dev@example.com",
    "name": "联调成员",
    "role": "USER"
  },
  "enterprise": {
    "id": "enterprise_id",
    "name": "客户端联调企业"
  },
  "devices": [
    {
      "id": "device_id",
      "fingerprint": "sep-client-dev-macbook",
      "platform": "darwin",
      "lastSeenAt": "2026-09-19T00:00:00.000Z"
    }
  ]
}
```

兼容说明：旧服务可能返回 `expiresIn`，客户端可兼容读取，但新服务以 `accessTokenExpiresIn` 和 `refreshTokenExpiresIn` 为准。

常见错误：

| HTTP 状态 | 含义 |
|---:|---|
| `400` | 请求字段校验失败 |
| `401` | 邮箱/密码错误，或设备已被吊销 |

### 3.2 刷新普通 access token

```http
POST /client/auth/refresh
Content-Type: application/json
```

```json
{
  "refreshToken": "<client-refresh-jwt>"
}
```

成功响应：

```json
{
  "accessToken": "<new-jwt>",
  "accessTokenExpiresIn": 3600,
  "user": {
    "id": "user_id",
    "email": "client-dev@example.com",
    "name": "联调成员",
    "role": "USER"
  },
  "enterprise": {
    "id": "enterprise_id",
    "name": "客户端联调企业"
  }
}
```

收到 `401` 时清理本地登录态并回到登录页；网络错误时不要立即删除仍可能有效的 `refreshToken`。

---

## 4. 获取当前用户可用员工订阅

### 4.1 接口

```http
GET /client/subscriptions
Authorization: Bearer <accessToken>
```

成功响应是**数组**，不是 `{ "data": [...] }`：

```json
[
  {
    "id": "subscription_id",
    "subscriptionId": "subscription_id",
    "employeeId": "employee_id",
    "name": "需求分析员",
    "status": "ACTIVE",
    "templateVersion": "1.0.0",
    "template": {
      "id": "employee_id",
      "name": "需求分析员",
      "avatar": "https://sep-dev.longdaoSEP.cn/assets/employees/silicon/product-manager.webp?v=6facaa2a11421f41",
      "avatarAsset": {
        "id": "silicon:product-manager",
        "version": "6facaa2a11421f41",
        "portraitUrl": "https://sep-dev.longdaoSEP.cn/assets/employees/silicon/product-manager.webp?v=6facaa2a11421f41",
        "faceUrl": "https://sep-dev.longdaoSEP.cn/assets/employees/silicon/product-manager-face.webp?v=6facaa2a11421f41"
      }
    },
    "department": null,
    "allowedModels": ["gemini-3.5-flash-high"],
    "upgradeAvailable": false
  }
]
```

### 4.2 字段说明

| 字段 | 说明 |
|---|---|
| `id` | 当前实现中与 `subscriptionId` 相同，建议统一使用 `subscriptionId` |
| `subscriptionId` | 订阅/雇佣关系 ID；换 employment token、获取运行时清单时使用 |
| `employeeId` | 数字员工模板 ID |
| `name` | 企业订阅名称，没有自定义名称时通常为员工名称 |
| `status` | 订阅状态；可用列表只返回 `ACTIVE` |
| `templateVersion` | 当前订阅锁定的员工模板版本 |
| `template.avatar` | 兼容旧客户端的完整主图 URL，等同于 `avatarAsset.portraitUrl` |
| `template.avatarAsset` | 新版头像统一契约，详见第 6 节 |
| `allowedModels` | 当前企业和平台共同允许的模型 ID 列表 |
| `upgradeAvailable` | 员工模板是否存在可升级版本 |

服务端已按当前登录成员过滤：必须属于企业、拥有有效的直接或部门 `EmployeeGrant`、订阅为 `ACTIVE` 且未到期。客户端仍要把后续包接口或网关的授权失败作为最终事实。

### 4.3 兼容路径

`GET /client/instances` 是迁移兼容别名。新客户端只调用 `/client/subscriptions`；只有在兼容旧服务且 `/client/subscriptions` 返回 `404` 时，才考虑尝试 `/client/instances`。

---

## 5. 获取订阅运行时清单

### 5.1 接口

```http
GET /client/subscriptions/:subscriptionId/runtime
Authorization: Bearer <accessToken>
```

成功响应：

```json
{
  "manifestVersion": 1,
  "subscriptionId": "subscription_id",
  "templateVersion": "1.0.0",
  "employee": {
    "id": "employee_id",
    "name": "需求分析员",
    "description": "整理需求与验收条件",
    "avatar": "https://sep-dev.longdaoSEP.cn/assets/employees/silicon/product-manager.webp?v=6facaa2a11421f41",
    "avatarAsset": {
      "id": "silicon:product-manager",
      "version": "6facaa2a11421f41",
      "portraitUrl": "https://sep-dev.longdaoSEP.cn/assets/employees/silicon/product-manager.webp?v=6facaa2a11421f41",
      "faceUrl": "https://sep-dev.longdaoSEP.cn/assets/employees/silicon/product-manager-face.webp?v=6facaa2a11421f41"
    },
    "version": "1.0.0",
    "maxSteps": 20
  },
  "runtime": {
    "systemPrompt": "<system prompt>",
    "modelId": "gemini-3.5-flash-high",
    "allowedModels": ["gemini-3.5-flash-high"],
    "config": null,
    "skills": [
      {
        "capabilityId": "capability_id",
        "name": "需求分析",
        "description": "分析需求并整理验收条件",
        "versionId": "skill_version_id",
        "version": "1.0.0",
        "content": "<approved skill markdown>"
      }
    ]
  }
}
```

| HTTP 状态 | 含义 |
|---:|---|
| `200` | 返回订阅锁定版本的运行时清单 |
| `401` | `accessToken` 无效或已过期 |
| `404` | 订阅不存在，或当前用户无法使用该订阅 |

运行时清单中的 `employee.avatarAsset` 与订阅列表中的 `template.avatarAsset` 应视为同一头像身份来源。头像素材的 `version` 独立于员工的 `templateVersion`：升级头像素材不代表员工包版本升级。

客户端不要把 `systemPrompt`、技能正文或 token 写入普通日志。运行时安装仍需执行客户端自己的版本校验、隔离和回滚策略。

---

## 6. 员工头像对接协议（本次重点）

### 6.1 数据结构

```typescript
interface EmployeeAvatarAsset {
  /** 平台头像身份 ID，用于缓存和身份判断 */
  id: string;
  /** 素材版本；外部自定义图片可能为 null */
  version: string | null;
  /** 人物主图，详情页/大图使用 */
  portraitUrl: string;
  /** 头肩裁切图，列表/聊天小头像使用 */
  faceUrl: string;
}
```

当前平台素材示例：

```json
{
  "id": "silicon:product-manager",
  "version": "6facaa2a11421f41",
  "portraitUrl": "https://sep-dev.longdaoSEP.cn/assets/employees/silicon/product-manager.webp?v=6facaa2a11421f41",
  "faceUrl": "https://sep-dev.longdaoSEP.cn/assets/employees/silicon/product-manager-face.webp?v=6facaa2a11421f41"
}
```

当前联调 fixture 已绑定：

| 员工 | `avatarAsset.id` | 主图 |
|---|---|---|
| 需求分析员 | `silicon:product-manager` | `product-manager.webp` |
| 测试验收员 | `silicon:qa-automation` | `qa-automation.webp` |

当前已验证的静态资源均返回 `200 image/webp`：

```text
https://sep-dev.longdaoSEP.cn/assets/employees/silicon/product-manager.webp
https://sep-dev.longdaoSEP.cn/assets/employees/silicon/product-manager-face.webp
https://sep-dev.longdaoSEP.cn/assets/employees/silicon/qa-automation.webp
https://sep-dev.longdaoSEP.cn/assets/employees/silicon/qa-automation-face.webp
```

### 6.2 客户端显示规则

| 使用场景 | 使用字段 |
|---|---|
| 订阅列表、员工切换器、聊天消息气泡、小尺寸头像 | `faceUrl` |
| 员工详情页、个人中心、大尺寸展示 | `portraitUrl` |
| 缓存 key、判断头像是否发生变化 | `id + version` |
| 图片加载失败 | 可先尝试同一对象的另一个 URL，最后使用员工姓名首字 |

必须遵守：

1. 直接使用接口返回的完整 URL，不自行拼接域名。
2. 保留 URL 中的 `?v=...` 版本参数，不能截断或重新排序后丢失版本参数。
3. 不要根据员工姓名、数组索引、随机数选择头像。
4. 不要把 `.webp` 手工替换为 `-face.webp`，也不要根据文件名规则自行推导另一张图片。
5. 不要根据 `avatarStyle` 自行拼接 DiceBear 或其他第三方头像 URL。
6. `avatarAsset` 为 `null` 时，兼容读取旧的 `avatar` 字段；两者都没有时显示默认占位或姓名首字。
7. `avatarAsset.id` 相同但 `version` 变化时，应更新缓存；不要永久缓存旧 URL。

推荐渲染逻辑：

```ts
function getEmployeeFaceUrl(employee: {
  name: string;
  avatar?: string | null;
  avatarAsset?: EmployeeAvatarAsset | null;
}) {
  return employee.avatarAsset?.faceUrl ?? employee.avatar ?? null;
}

function getEmployeePortraitUrl(employee: {
  name: string;
  avatar?: string | null;
  avatarAsset?: EmployeeAvatarAsset | null;
}) {
  return employee.avatarAsset?.portraitUrl ?? employee.avatar ?? null;
}
```

> 上述代码只用于展示兼容优先级；生产代码还应在图片组件中实现加载失败回退和姓名首字占位。

### 6.3 头像缓存建议

```text
avatar:<avatarAsset.id>:<avatarAsset.version>:face
avatar:<avatarAsset.id>:<avatarAsset.version>:portrait
```

如果 `version === null`，可以使用完整 URL 参与缓存 key。不要仅以员工名称作为缓存 key，因为企业可重命名订阅，平台也可能为同一员工替换素材。

---

## 7. 换取 employment token 与调用模型网关

### 7.1 换取 employment token

```http
POST /client/auth/token
Content-Type: application/json
```

请求体：

```json
{
  "refreshToken": "<client-refresh-jwt>",
  "subscriptionId": "subscription_id"
}
```

成功响应：

```json
{
  "employmentToken": "<short-lived-jwt>",
  "expiresIn": 900,
  "employment": {
    "id": "subscription_id",
    "name": "需求分析员",
    "templateId": "employee_id",
    "status": "ACTIVE"
  }
}
```

当前请求字段是 `subscriptionId`，不是旧字段 `instanceId`。服务端会检查 refresh token 类型、设备状态、企业成员关系、订阅状态及当前成员的员工授权。

### 7.2 调用 OpenAI-compatible 模型网关

```http
POST /gateway/v1/chat/completions
Authorization: Bearer <employmentToken>
Content-Type: application/json
```

非流式请求示例：

```json
{
  "model": "gemini-3.5-flash-high",
  "messages": [
    {
      "role": "user",
      "content": "请回复 OK。"
    }
  ],
  "max_tokens": 32,
  "stream": false
}
```

流式请求将返回 SSE，客户端按 OpenAI-compatible `data: ...` 行读取，结束标志为：

```text
data: [DONE]
```

客户端只发送 `allowedModels` 中的模型 ID 和消息内容，不发送任何上游模型密钥。模型不在白名单、订阅失效、余额不足或授权失效时，网关会返回错误，客户端应刷新订阅列表并按错误状态处理。

---

## 8. 其他当前客户端可用接口

以下接口使用普通 `accessToken`，不是 `employmentToken`：

| 接口 | 用途 |
|---|---|
| `GET /enterprise/organization` | 获取企业、部门、成员、员工目录及当前可见授权摘要 |
| `GET /enterprise/overview` | 获取企业首页统计和员工概览 |
| `GET /enterprise/employee-status` | 获取员工运行状态；运行状态不要从订阅 `status` 推导 |
| `GET /enterprise/subscriptions/:subscriptionId/package` | 获取订阅锁定的员工包元数据 |
| `GET /enterprise/subscriptions/:subscriptionId/package/download` | 下载 ZIP 员工包兜底文件流 |
| `GET /enterprise/employees/:employeeId/skills` | 获取员工技能和可用版本 |
| `GET /enterprise/skill-versions/:versionId/preview` | 预览已审核技能正文 |
| `GET /knowledge-bases/grants/by-subscription/:subscriptionId` | 获取订阅被授权的知识库 |

组织目录中的 `status` 是订阅状态，不能当作员工实时运行状态；实时运行状态使用 `/enterprise/employee-status` 及对应 WebSocket。

头像风格管理接口属于平台运营端能力，客户端不调用，也不根据风格 ID 自行生成图片。客户端始终消费员工接口返回的 `avatar` / `avatarAsset`。

---

## 9. 错误处理与兼容策略

### 9.1 通用处理

1. `401`：先尝试一次普通 token 刷新；刷新仍失败则清理登录态并回登录页。
2. `403`：当前用户或订阅没有权限，不要无限重试；可刷新订阅列表后更新 UI。
3. `404`：资源不存在或已不可用；订阅列表需要重新拉取。
4. `429`：按响应头或指数退避重试，避免并发重试风暴。
5. `5xx` 或网络错误：保留本地安全凭据，显示可重试状态，不要把 token 写入错误信息。
6. 所有请求保留服务端返回的 `x-request-id`（如果有），仅用于脱敏后的问题定位。

### 9.2 旧服务兼容

| 旧字段/路径 | 当前处理 |
|---|---|
| `/client/instances` | 新代码使用 `/client/subscriptions`；旧服务返回 `/client/subscriptions` 为 `404` 时才兼容尝试 |
| `template.avatar` | 作为旧头像字段保留，优先使用 `template.avatarAsset` |
| `employee.avatar` | `avatarAsset` 缺失时的旧字段回退 |
| `expiresIn` | 兼容旧登录响应；新登录响应读取 `accessTokenExpiresIn` |
| `instanceId` | 不再发送；换 token 使用 `subscriptionId` |
| `instanceToken` / `instance` | 不再解析；当前响应使用 `employmentToken` / `employment` |

---

## 10. 客户端联调验收清单

### 环境和认证

- [ ] `SEP_BASE_URL` 配置为 `https://sep-dev.longdaoSEP.cn/api`，没有重复 `/api`。
- [ ] 登录成功并拿到 `accessToken`、`refreshToken`、过期时间和设备列表。
- [ ] `accessToken` 只存在 Electron main 内存，`refreshToken` 使用安全存储。
- [ ] 普通 token 过期后可以调用 `/client/auth/refresh`，并发刷新会合并。

### 订阅和运行时

- [ ] `GET /client/subscriptions` 返回数组。
- [ ] 列表中可以拿到 `subscriptionId`、`employeeId`、`allowedModels`。
- [ ] 使用真实 `subscriptionId` 成功获取 `/runtime`。
- [ ] 运行时 `templateVersion`、`employee` 和 `skills` 可正常落入客户端运行时。
- [ ] 没有授权、订阅暂停/终止或授权过期时，客户端不会继续执行本地员工。

### 头像

- [ ] 列表读取 `template.avatarAsset`，运行时读取 `employee.avatarAsset`。
- [ ] 列表/聊天使用 `faceUrl`，详情/大图使用 `portraitUrl`。
- [ ] 图片 URL 中的 `?v=...` 未被丢弃。
- [ ] 不根据姓名、索引或文件名规则自行选图。
- [ ] 图片加载失败时有同一 `avatarAsset` 的回退和姓名首字占位。
- [ ] `avatarAsset.id + version` 变化时可以刷新缓存。
- [ ] 头像接口返回 `null` 时仍能兼容旧的 `avatar` 字段。

### 网关

- [ ] 使用 `/client/auth/token`，请求字段为 `subscriptionId`。
- [ ] 使用 `employmentToken` 调用 `/gateway/v1/chat/completions`。
- [ ] 使用 `allowedModels` 中的模型 ID。
- [ ] 非流式响应和 SSE 流式响应均可正常解析。
- [ ] 不向客户端或 SEP 请求上游模型 API Key。

---

## 11. 联调问题反馈格式

请至少提供以下信息，禁止提供密码和完整 token：

```text
环境：sep-dev.longdaoSEP.cn
客户端版本：
操作系统：darwin / win32 / linux
接口路径：
HTTP 状态码：
x-request-id：
subscriptionId（可脱敏）：
avatarAsset.id：
avatarAsset.version：
是否能在浏览器打开 portraitUrl/faceUrl：
问题现象：
```

如需核对部署状态，可先检查：

```bash
curl -i https://sep-dev.longdaoSEP.cn/api/health
curl -i https://sep-dev.longdaoSEP.cn/api/health/ready
```

头像资源检查示例：

```bash
curl -I 'https://sep-dev.longdaoSEP.cn/assets/employees/silicon/product-manager.webp?v=6facaa2a11421f41'
curl -I 'https://sep-dev.longdaoSEP.cn/assets/employees/silicon/product-manager-face.webp?v=6facaa2a11421f41'
```

预期头像响应为 `200`，并带有 `Content-Type: image/webp`。

---

## 12. 相关文档

- [SEP 客户端共享联调完整对接文档](SEP-客户端共享联调完整对接文档-v1.md)
- [SEP 客户端补充接口](SEP-客户端补充接口-2026-09-16.md)
- [员工头像共享协议](员工头像共享协议.md)
- [SEP 与客户端对接开发规范](SEP与客户端对接开发规范-v1.md)


---

## 13. 当前客户端对接范围与接口缺口

### 13.1 结论先行

**当前不需要为了头像再新增接口。** 头像已经随两个客户端主流程接口返回，客户端直接消费 `avatarAsset` 即可：

- `GET /client/subscriptions`：读取 `template.avatarAsset`；
- `GET /client/subscriptions/:subscriptionId/runtime`：读取 `employee.avatarAsset`；
- 列表、聊天、小尺寸使用 `faceUrl`；详情、大图使用 `portraitUrl`；
- `avatarAsset` 缺失时回退旧字段 `avatar`，图片失败时使用同对象另一 URL，最后显示姓名首字。

当前客户端首期可以按以下顺序完成联调，不需要等待新 API：

```text
认证与设备 → 订阅列表 → runtime 清单 → 头像展示
→ employmentToken → 模型网关 → 包/技能（如启用）
→ 知识库（如启用） → 任务镜像 → 通知与员工状态
```

### 13.2 已具备、建议纳入客户端联调的接口

| 对接域 | 当前接口 | 是否需要新增 | 客户端注意事项 |
|---|---|---|---|
| 认证 | `POST /client/auth/login`、`POST /client/auth/refresh`、`POST /client/auth/token` | 否 | `auth/token` 使用 `refreshToken + subscriptionId` 换 `employmentToken`，不能用 `accessToken` 替代；设备被吊销后应回登录流程 |
| 订阅与运行时 | `GET /client/subscriptions`、`GET /client/subscriptions/:subscriptionId/runtime` | 否 | 新客户端使用 `subscriptionId`；runtime 已包含系统提示词、模型白名单、配置和已审核技能 |
| 头像 | 订阅列表和 runtime 中的 `avatarAsset` | 否 | 不要拼接域名、改后缀或自行生成 `faceUrl`；保留 URL 中的 `?v=` 版本参数 |
| 模型调用 | `POST /gateway/v1/chat/completions` | 否 | 使用 `employmentToken`；只发送 `allowedModels` 中的 `modelId`；支持非流式和 SSE |
| 组织与员工 | `GET /enterprise/organization`、`GET /enterprise/overview`、`GET /enterprise/employee-status` | 否 | 运行状态使用 `employee-status`，不要把订阅 `status` 当成实时运行状态 |
| 员工包 | `GET /enterprise/subscriptions/:subscriptionId/package`、`GET /enterprise/subscriptions/:subscriptionId/package/download` | 否 | 下载后校验 `X-SHA256`、`X-Version`，采用临时文件下载和原子替换 |
| Skill | `GET /enterprise/employees/:employeeId/skills`、`GET /enterprise/skill-versions/:versionId/preview` | 否 | 只安装服务端返回的已审核/允许版本；个人 Skill 送审接口见补充文档 |
| 知识库 | `GET /knowledge-bases/grants/by-subscription/:subscriptionId`、`POST /knowledge-bases/search` | 否 | 使用普通 `accessToken`；搜索请求必须带 `subscriptionId` |
| 任务镜像 | `POST /client/tasks`、`PATCH /client/tasks/:id/status`、`POST /client/tasks/:id/heartbeat`、`POST /client/tasks/:id/events`、`GET /client/tasks`、`GET /client/tasks/:id` | 否（首期） | 云端保存监控镜像；任务正文、本地文件、完整 prompt 和工具执行仍留在客户端；事件 `sequence` 必须递增且可重试 |

### 13.3 通知与员工状态：已有接口，但客户端需要补齐接入策略

如果桌面客户端需要接收审批、订阅、额度或系统通知，直接使用现有通知 REST API 和 WebSocket，不需要新增一套客户端专用通知 API。

**通知 REST API：**

```http
GET    /notifications?limit=50&offset=0&category=<category>&unreadOnly=true
GET    /notifications/unread-count?category=<category>
POST   /notifications/:id/read
POST   /notifications/read-all?category=<category>
DELETE /notifications/clear-read?category=<category>
DELETE /notifications/:id
```

上述接口使用普通 `accessToken`。写操作返回 `204` 时，客户端应以 HTTP 成功为准，不要求解析响应体。

**通知 WebSocket：** `wss://sep-dev.longdaoSEP.cn/ws/notifications`

连接建立后 5 秒内发送首条认证消息：

```json
{"type":"auth","token":"<accessToken>"}
```

服务端消息类型：

- `connected`：认证成功，`data.unreadCount` 为当前未读数；
- `notification`：新通知，`data` 为通知对象；
- `unread_count`：未读数变化，`data.count` 为最新数量；
- `pong`：客户端发送 `ping` 后的心跳响应。

客户端必须实现：断线指数退避重连、每次重连重新发送 `auth`、连接断开期间通过 `GET /notifications` 补拉；不要把 token 放在 WebSocket URL 查询参数中。

**员工状态 WebSocket：** `wss://sep-dev.longdaoSEP.cn/ws/employee-status`

认证消息格式相同。认证成功后服务端会立即发送 `status_update`，之后约每 3 秒推送一次；断线重连后应重新认证，并通过 `GET /enterprise/employee-status` 做一次 HTTP 补偿。

### 13.4 当前不建议马上新增的接口

以下能力已有替代方案，当前不构成客户端联调阻塞：

1. **订阅详情接口**：runtime 已返回客户端执行所需的订阅锁定版本信息，不需要再新增 `/client/subscriptions/:id`。
2. **头像专用接口或头像上传接口**：当前头像是平台员工资产，不是客户端上传内容；`avatarAsset` 已覆盖展示和缓存所需信息。
3. **Web 专用任务接口**：客户端使用 `/client/tasks` 上报镜像，Web 端已有监控页面；不要把 `/api/tasks` 或 `/api/task-plans` 当作客户端同步接口。
4. **单独 Skill 内容接口**：runtime 和 Skill preview 已提供当前可执行/可预览内容。
5. **客户端设备列表接口**：登录响应已经返回当前有效设备列表。若只要求本地退出，删除本地 `refreshToken` 即可；服务端撤销能力可后续再补。

### 13.5 后续可选新增接口（按产品确认后排期）

这些不是当前头像或首期联调的必需项，只有对应产品场景明确后再新增：

| 优先级 | 候选接口 | 触发条件 | 设计注意事项 |
|---|---|---|---|
| P1 | `GET /client/tasks/:id/events?afterSequence=123` | 任务事件数量变大，需要断线增量补偿 | 使用 `sequence` 游标；保留幂等语义，不返回完整 prompt 或本地文件 |
| P1 | `GET /client/tasks?page=1&limit=50&status=RUNNING` | 企业任务超过当前固定最多 100 条，或需要筛选/分页 | 需要限制 `limit` 上限并定义稳定排序与游标/页码语义 |
| P1 | `POST /client/tasks/:id/cancel` | Web 端需要远程取消正在运行的桌面任务 | 不能只加 HTTP 接口；还要设计客户端拉取/WS 控制通道、权限、幂等和取消确认 |
| P2 | `GET /client/devices`、`POST /client/auth/logout`、`DELETE /client/devices/:deviceId` | 需要多设备管理、服务端主动退出或设备解绑 | 需要定义 refresh token 立即失效、当前设备退出和管理员吊销的行为 |
| P2 | 订阅变更增量/ETag 接口 | 订阅规模较大或离线缓存要求较高 | 首期定期重新拉取 `/client/subscriptions` 即可 |

**建议当前先不实现上述新增接口。** 先以现有 API 完成认证、订阅/runtime、头像、网关、通知/状态和任务镜像的端到端验收；等客户端明确“远程取消”“断线事件补偿”或“多设备服务端注销”需求后，再按对应方案扩展。

### 13.6 已发现的契约文档修正项（不是新增接口）

代码路径已经具备对应能力，但 Swagger 文案有两处需要与当前契约对齐：

- `POST /client/auth/token` 的 summary/响应说明仍使用“实例令牌”，新文案应统一为“订阅 employment token”；
- `GET /client/subscriptions/:subscriptionId/runtime` 实际在订阅不存在、无授权或不可用时会返回 `404`，Swagger 应明确声明 `404`。

这两项只修正接口文档，不改变请求路径和业务行为。
