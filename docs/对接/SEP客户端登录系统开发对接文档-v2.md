# SEP 客户端登录系统开发对接文档 v2

> **文档版本**：v2.0  
> **编写日期**：2026-09-28  
> **适用对象**：`sep-client` Electron 桌面客户端开发者、客户端联调人员、测试人员  
> **对应平台**：SEP 硅基人才平台  
> **状态**：客户端改造与联调基线

---

## 1. 文档目的

SEP 的认证中心已经从早期的简单登录，升级为包含以下能力的统一认证体系：

- Web 端与桌面客户端分离的登录会话；
- 桌面设备注册、设备指纹和设备吊销；
- Access Token、Refresh Token、Employment Token 分层；
- Refresh Token 数据库存储、轮换和重放检测；
- 密码找回、密码修改、会话撤销和登录风控；
- 微信、QQ Web OAuth 登录能力（当前仍处于平台配置阶段）；
- 订阅授权和员工级模型调用令牌。

因此，`sep-client` **需要对现有登录实现进行一次完整适配**，不能继续把旧版 Web 登录流程或旧版 `instanceId` 流程直接当作当前契约。

本文给出客户端需要实现的最终接入方式、接口契约、令牌生命周期、安全边界、并发处理、错误处理和验收标准。

---

## 2. 先看结论

### 2.1 客户端是否需要改动？

**需要改动。**

客户端至少需要完成以下改造：

1. 登录接口固定使用 `/api/client/auth/login`，不要使用 Web 的 `/api/auth/login`；
2. 客户端自行安全保存 Refresh Token，不能依赖 Web Cookie；
3. Access Token 只放在 Electron `main` 进程内存；
4. Refresh Token 轮换后，必须用响应中的新值原子替换旧值；
5. 所有会消费 Refresh Token 的操作必须串行化，避免并发刷新导致令牌重放；
6. 员工授权从 `/client/subscriptions` 获取，新的业务主键是 `subscriptionId`；
7. 获取员工级令牌时使用 `/client/auth/token`，请求字段使用 `subscriptionId`，不再使用 `instanceId`；
8. 模型网关必须使用 `employmentToken`，不能使用普通 `accessToken`；
9. Electron renderer 不得直接请求 SEP，也不得接触任何令牌；
10. 微信/QQ 当前只完成 Web OAuth 后端能力，暂时不能直接作为桌面客户端登录方式。

### 2.2 微信/QQ 暂时无法配置，是否影响客户端开发？

**不影响邮箱密码登录和客户端主体开发。**

当前客户端可以先完整实现：

```text
邮箱 + 密码
  → 桌面设备注册
  → 获取 accessToken / refreshToken
  → 获取 subscriptionId
  → 获取 employmentToken
  → 调用模型网关
```

微信和 QQ 的 AppID、AppSecret/AppKey、回调地址需要在第三方开发者平台申请完成后，才能进行真实 OAuth 联调。它们目前属于 Web 认证中心配置，不是客户端邮箱密码登录的前置条件。

---

## 3. 认证架构与职责边界

### 3.1 Web 登录和桌面客户端登录不是同一个流程

| 项目 | Web 端 | 桌面客户端 |
|---|---|---|
| 登录接口 | `POST /api/auth/login` | `POST /api/client/auth/login` |
| Refresh Token | 后端设置 `httpOnly` Cookie | JSON body 返回，客户端安全存储 |
| Access Token | 前端内存状态 | Electron `main` 进程内存 |
| 设备注册 | 不以桌面设备为主 | 登录时注册/更新设备 |
| 设备吊销 | 管理后台可撤销会话 | 管理后台可撤销设备，客户端必须退出 |
| OAuth | 当前支持 Web 流程 | 当前暂不支持直接 OAuth |
| 适用场景 | 浏览器运营端/用户端 | `sep-client` Electron 桌面端 |

**禁止事项：**

- 桌面端不要调用 `/api/auth/login`；
- 桌面端不要依赖浏览器 Cookie 维持登录；
- 不要把 Web `/oauth/callback` 页面当作桌面 OAuth 回调；
- 不要让客户端保存微信 AppSecret、QQ AppKey 或任何上游模型密钥。

### 3.2 推荐的 Electron 进程分工

```text
Electron renderer
  │ 仅调用 IPC，不接触 token，不直接 fetch SEP
  ▼
Electron main
  ├─ SEPHttpClient：统一请求、超时、错误解析
  ├─ AuthSessionManager：登录、刷新、退出、设备吊销
  ├─ safeStorage：保存 refreshToken
  ├─ 内存：accessToken、employmentToken
  ├─ SubscriptionManager：订阅目录和运行时清单
  └─ GatewayClient：使用 employmentToken 调模型网关
```

### 3.3 Token 的持有位置

| 令牌 | 服务端含义 | 默认有效期 | 客户端存储位置 | 用途 |
|---|---|---:|---|---|
| `accessToken` | 普通用户访问令牌，JWT | 3600 秒 | 仅 `main` 进程内存 | 订阅目录、运行时、任务等普通 API |
| `refreshToken` | 数据库 opaque 令牌，非 JWT | 默认 30 天 | Electron `safeStorage` 或系统密钥链 | 刷新 access token、换 employment token |
| `employmentToken` | 员工/订阅级短期 JWT | 默认 900 秒，可配置 | 仅 `main` 进程内存，按 `subscriptionId` 缓存 | 仅模型网关 |

> 注意：当前 Refresh Token 是数据库 opaque token。客户端不应解析它的 JWT 结构，也不应根据 token 文本推算过期时间。以接口返回的 `refreshTokenExpiresIn` 和服务端响应为准。

### 3.4 令牌绝对不能出现的位置

以下位置禁止保存或输出令牌：

- renderer 页面状态、React props、浏览器 localStorage、sessionStorage；
- URL 查询参数、URL fragment、深链参数；
- 日志、崩溃上报、错误消息、任务正文、截图；
- IPC 返回给 renderer 的对象；
- Git、`.env`、配置文件、员工包或本地任务 JSON；
- 客户端代码中的 `SUB2API_API_KEY`、微信密钥或 QQ 密钥。

---

## 4. 环境和基础 URL

### 4.1 基础 URL 定义

客户端统一定义一个 API 基础地址：

```text
SEP_API_BASE_URL=https://<SEP正式域名>/api
```

例如：

```text
https://longdaoSEP.cn/api
```

接口路径在本文中均相对于 `SEP_API_BASE_URL`。因此：

```text
POST /client/auth/login
```

实际请求地址为：

```text
https://<SEP正式域名>/api/client/auth/login
```

**不要重复拼接 `/api`。**

### 4.2 环境建议

| 环境 | `SEP_API_BASE_URL` 示例 | 说明 |
|---|---|---|
| 本地 | `http://localhost:3001/api` | 直接访问 NestJS 后端 |
| 本地同源代理 | `http://localhost:3000/api` | 仅适用于需要复用 Web 代理的场景 |
| 测试 | `https://sep-dev.<domain>/api` | 使用测试账号和测试数据库 |
| 生产 | `https://<正式域名>/api` | 必须 HTTPS |

客户端不能把测试域名、生产域名散落在业务代码中，应通过环境配置或发行渠道配置注入。

### 4.3 请求通用要求

```http
Content-Type: application/json
Accept: application/json
User-Agent: sep-client/<clientVersion>
```

普通需要认证的 API：

```http
Authorization: Bearer <accessToken>
```

模型网关：

```http
Authorization: Bearer <employmentToken>
```

桌面认证接口不依赖 Cookie，也不需要浏览器 `Origin`。不要为了“模拟浏览器”自行保存或发送 Web refresh cookie。

---

## 5. 完整登录流程

### 5.1 首次启动流程

```text
启动客户端
  │
  ├─ 从 safeStorage 读取 refreshToken
  │
  ├─ 没有 refreshToken
  │    └─ 展示登录页
  │
  └─ 有 refreshToken
       │
       ├─ POST /client/auth/refresh
       │
       ├─ 成功：保存新 refreshToken，内存写入 accessToken
       │          → GET /client/subscriptions
       │          → 进入主界面
       │
       └─ 明确 401：清理登录态 → 展示登录页
```

### 5.2 邮箱密码登录流程

```text
用户输入邮箱和密码
  │
  ▼
POST /client/auth/login
  │
  ├─ 服务端校验账号、密码、账号状态和登录风控
  ├─ 注册或更新当前设备
  ├─ 检查设备是否被吊销
  ├─ 创建 DESKTOP 会话
  └─ 返回 accessToken + refreshToken
       │
       ├─ refreshToken 写入 safeStorage
       ├─ accessToken 只写入 main 内存
       ├─ 清空旧 employmentToken 缓存
       └─ GET /client/subscriptions
```

### 5.3 选择员工并调用模型流程

```text
GET /client/subscriptions
  │
  ├─ 选择一个 subscriptionId
  ├─ GET /client/subscriptions/:subscriptionId/runtime
  ├─ POST /client/auth/token
  │    └─ 返回 employmentToken + 新 refreshToken
  └─ POST /gateway/v1/chat/completions
       └─ Authorization: Bearer employmentToken
```

### 5.4 Access Token 过期流程

```text
普通 API 返回 401
  │
  ├─ 如果本次请求已经重试过：停止并回登录页/报错
  └─ 否则进入单飞刷新
       │
       ├─ POST /client/auth/refresh
       ├─ 原子替换 refreshToken
       ├─ 更新 accessToken
       └─ 原请求最多重试一次
```

### 5.5 Employment Token 过期流程

```text
网关返回 401
  │
  ├─ 对当前 subscriptionId 单飞刷新 employmentToken
  ├─ /client/auth/token 会同时轮换 refreshToken
  ├─ 原网关请求最多重试一次
  └─ 若返回 403/404：重新拉订阅目录，不循环重试
```

---

## 6. API 接口契约

> 以下路径均相对于 `SEP_API_BASE_URL`。如果 `SEP_API_BASE_URL=https://example.com/api`，则 `/client/auth/login` 的完整地址是 `https://example.com/api/client/auth/login`。

### 6.1 客户端登录

#### 请求

```http
POST /client/auth/login
Content-Type: application/json
```

```json
{
  "email": "user@example.com",
  "password": "用户密码",
  "fingerprint": "stable-device-fingerprint",
  "platform": "darwin",
  "clientVersion": "1.0.0"
}
```

#### 请求字段

| 字段 | 类型 | 必填 | 说明 |
|---|---|---:|---|
| `email` | string | 是 | 用户邮箱，服务端按邮箱规则校验 |
| `password` | string | 是 | 用户密码，不能为空 |
| `fingerprint` | string | 是 | 稳定设备指纹，1-256 字符 |
| `platform` | string | 是 | 推荐使用 `darwin`、`win32`、`linux` |
| `clientVersion` | string | 否 | 客户端版本号 |

#### 设备指纹要求

- 同一台设备在升级客户端、重启客户端后应保持稳定；
- 不要每次启动随机生成 UUID；
- 不要把邮箱、密码、Access Token 拼进指纹；
- 不要上传原始硬件序列号，建议在本地组合后做不可逆哈希；
- 指纹最长 256 字符；
- 如果设备重装系统导致指纹变化，服务端可能将其识别为新设备。

#### 成功响应：`200 OK`

```json
{
  "accessToken": "<access-token-jwt>",
  "refreshToken": "<opaque-refresh-token>",
  "accessTokenExpiresIn": 3600,
  "refreshTokenExpiresIn": 2592000,
  "user": {
    "id": "user_id",
    "email": "user@example.com",
    "name": "用户名称",
    "role": "USER"
  },
  "enterprise": {
    "id": "enterprise_id",
    "name": "企业名称"
  },
  "devices": [
    {
      "id": "device_id",
      "fingerprint": "stable-device-fingerprint",
      "platform": "darwin",
      "lastSeenAt": "2026-09-28T00:00:00.000Z"
    }
  ]
}
```

#### 响应字段

| 字段 | 说明 |
|---|---|
| `accessToken` | 普通 API 使用的短期 JWT |
| `refreshToken` | 桌面会话的 opaque refresh token，必须安全保存 |
| `accessTokenExpiresIn` | Access Token 有效秒数，当前默认 3600 |
| `refreshTokenExpiresIn` | Refresh Token 有效秒数，当前默认 2592000 |
| `user` | 当前用户基本信息 |
| `enterprise` | 当前用户的企业信息，没有企业时为 `null` |
| `devices` | 当前用户未吊销的设备列表 |

#### 登录处理要求

1. 收到成功响应后，先把新 Refresh Token 写入安全存储；
2. 安全存储写入成功后再更新内存会话；
3. 清理当前用户旧的 employment token 缓存；
4. 使用返回的 `accessTokenExpiresIn` 计算刷新时间；
5. 不要保存服务端返回的密码或完整登录响应；
6. 不要把登录响应原样发送到 renderer，应该只返回必要的脱敏用户信息。

#### 常见错误

| HTTP 状态 | 客户端处理 |
|---:|---|
| `400` | 显示参数校验错误，不重试 |
| `401` | 统一显示“邮箱或密码错误”，或提示设备已被吊销；不要暴露账号是否存在 |
| `429` | 读取 `Retry-After`，等待后再试；不要快速循环重试 |
| `5xx` | 显示服务暂不可用，可有限次数退避重试 |
| 网络错误 | 保留用户输入状态，不清理已有 refreshToken |

---

### 6.2 刷新普通 Access Token

#### 请求

```http
POST /client/auth/refresh
Content-Type: application/json
```

```json
{
  "refreshToken": "<current-refresh-token>"
}
```

#### 成功响应：`200 OK`

```json
{
  "accessToken": "<new-access-token-jwt>",
  "refreshToken": "<new-opaque-refresh-token>",
  "accessTokenExpiresIn": 3600,
  "refreshTokenExpiresIn": 2592000,
  "user": {
    "id": "user_id",
    "email": "user@example.com",
    "name": "用户名称",
    "role": "USER"
  },
  "enterprise": {
    "id": "enterprise_id",
    "name": "企业名称"
  }
}
```

#### 关键规则：Refresh Token Rotation

当前服务端每次成功刷新都会轮换 Refresh Token：

```text
旧 refreshToken → 服务端标记为已使用 → 返回新 refreshToken
```

客户端必须：

- 用响应中的新 `refreshToken` 覆盖旧值；
- 覆盖过程尽量原子化；
- 新值写入失败时，不得继续假设会话可恢复；
- 不能重复提交已经使用过的旧值；
- 不能让两个并发请求同时携带同一个旧值。

如果旧 Refresh Token 被再次使用，服务端会按重放攻击处理，并可能撤销整个 session family。**因此并发刷新不是性能优化，而是认证正确性的硬要求。**

#### 刷新时机

建议在 Access Token 剩余约 2-5 分钟时主动刷新；同时保留收到 `401` 后的兜底刷新。

不要仅依靠本地计时器，因为：

- 客户端可能休眠；
- 系统时间可能变化；
- 网络请求可能延迟；
- 服务端配置可能调整。

#### 刷新失败处理

| 情况 | 处理 |
|---|---|
| 网络超时、DNS 失败、5xx | 保留 refreshToken，稍后退避重试 |
| `401 Invalid or expired refresh token` | 清理 refreshToken、accessToken、employmentToken，回登录页 |
| 设备已吊销 | 清理登录态，提示用户“当前设备已被管理员停用” |
| `429` | 按 `Retry-After` 等待，禁止立即循环 |

---

### 6.3 客户端退出登录

#### 请求

```http
POST /client/auth/logout
Content-Type: application/json
```

```json
{
  "refreshToken": "<current-refresh-token>"
}
```

#### 成功响应

```http
204 No Content
```

#### 客户端退出动作

无论服务端返回 `204` 还是网络失败，用户主动点击退出后都应立即：

1. 停止新的模型请求和云端 API 请求；
2. 清除内存中的 `accessToken`；
3. 清除所有 `employmentToken`；
4. 删除安全存储中的 `refreshToken`；
5. 清除用户级缓存、订阅选择和敏感用户信息；
6. 通知 renderer 回到登录页面。

服务端退出请求应尽力发送，但不能因为等待退出接口而继续暴露已显示的登录态。

---

### 6.4 获取可用订阅

#### 请求

```http
GET /client/subscriptions
Authorization: Bearer <accessToken>
```

#### 成功响应：`200 OK`

响应是数组，不是 `{ "data": [] }`：

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
      "avatar": "https://example.com/avatar.webp",
      "avatarAsset": {
        "id": "silicon:product-manager",
        "version": "asset-version",
        "portraitUrl": "https://example.com/portrait.webp",
        "faceUrl": "https://example.com/face.webp"
      }
    },
    "department": null,
    "allowedModels": ["model-id"],
    "upgradeAvailable": false
  }
]
```

#### 字段使用规则

| 字段 | 用途 |
|---|---|
| `id` / `subscriptionId` | 当前订阅的主键，后续统一使用 `subscriptionId` |
| `employeeId` | 平台数字员工模板 ID，不等同于订阅 ID |
| `name` | 展示名称 |
| `status` | 当前通常为 `ACTIVE`；客户端仍需处理失效状态 |
| `templateVersion` | 服务端锁定的员工模板版本 |
| `template` | 员工展示信息和头像资源 |
| `department` | 授权来源部门，没有部门时为 `null` |
| `allowedModels` | 当前订阅可用的模型白名单 |
| `upgradeAvailable` | 是否存在可升级版本提示 |

服务端已经过滤以下条件：

- 用户属于对应企业；
- 用户拥有直接或部门 `EmployeeGrant`；
- 授权未过期；
- 订阅状态为 `ACTIVE`；
- 订阅未超过结束时间。

客户端仍不能把本地缓存当作最终授权依据。网关和其他业务接口会再次校验授权。

#### 兼容路径

```http
GET /client/instances
```

这是旧版迁移兼容别名。新客户端必须使用 `/client/subscriptions`，不要继续在新代码中使用 `instanceId` 作为领域主键。

---

### 6.5 获取订阅运行时清单

#### 请求

```http
GET /client/subscriptions/:subscriptionId/runtime
Authorization: Bearer <accessToken>
```

#### 用途

用于获取服务端锁定的员工运行时配置，包括：

- `manifestVersion`；
- `subscriptionId`；
- `templateVersion`；
- 员工基本信息；
- 系统提示词；
- 服务端允许的模型；
- 企业订阅配置；
- 已审核并生效的技能内容。

客户端不要自行拼接系统提示词、推测技能版本或绕过服务端返回的版本信息。

#### 示例响应结构

```json
{
  "manifestVersion": 1,
  "subscriptionId": "subscription_id",
  "templateVersion": "1.0.0",
  "employee": {
    "id": "employee_id",
    "name": "需求分析员",
    "description": "...",
    "avatar": null
  },
  "runtime": {
    "systemPrompt": "...",
    "modelId": "model-id",
    "allowedModels": ["model-id"],
    "config": null,
    "skills": [
      {
        "capabilityId": "capability_id",
        "name": "能力名称",
        "description": "能力描述",
        "versionId": "skill_version_id",
        "version": "1.0.0",
        "content": "已审核技能正文"
      }
    ]
  }
}
```

#### 错误处理

| HTTP 状态 | 处理 |
|---:|---|
| `401` | 刷新 accessToken 后最多重试一次 |
| `403` | 当前用户无权使用该订阅，刷新订阅目录并停止运行 |
| `404` | 订阅或运行时不存在，刷新订阅目录并停止运行 |
| `429` | 按 `Retry-After` 退避 |
| `5xx` | 有限次数重试，不要伪造本地运行时成功 |

---

### 6.6 获取 Employment Token

#### 请求

```http
POST /client/auth/token
Content-Type: application/json
```

```json
{
  "refreshToken": "<current-refresh-token>",
  "subscriptionId": "subscription_id"
}
```

#### 成功响应：`200 OK`

```json
{
  "employmentToken": "<short-lived-employment-jwt>",
  "expiresIn": 900,
  "refreshToken": "<new-opaque-refresh-token>",
  "refreshTokenExpiresIn": 2592000,
  "employment": {
    "id": "subscription_id",
    "name": "需求分析员",
    "templateId": "employee_id",
    "status": "ACTIVE"
  }
}
```

#### 重要变化

`/client/auth/token` 不仅签发 Employment Token，也会轮换 Refresh Token。因此客户端收到成功响应后必须同时处理：

```text
employmentToken → 写入内存缓存
refreshToken    → 原子替换 safeStorage 中的旧值
```

#### 旧版错误写法

不要再发送：

```json
{
  "refreshToken": "...",
  "instanceId": "instance_id"
}
```

正确字段是：

```json
{
  "refreshToken": "...",
  "subscriptionId": "subscription_id"
}
```

#### 服务端校验内容

服务端会检查：

1. Refresh Token 是否有效且属于 `DESKTOP` session；
2. 当前设备是否存在且未吊销；
3. 订阅是否存在；
4. 订阅状态是否为 `ACTIVE`；
5. 订阅是否已经过期；
6. 用户是否属于订阅所属企业；
7. 用户是否拥有有效的直接或部门员工授权；
8. 轮换 Refresh Token 并签发短期 Employment Token。

#### Employment Token 缓存策略

建议按 `subscriptionId` 缓存：

```text
Map<subscriptionId, {
  employmentToken,
  expiresAt,
  employment
}>
```

当剩余有效期小于以下任一条件时刷新：

- 剩余时间小于 60 秒；
- 剩余时间小于总有效期的三分之一。

同一个订阅的并发换 token 请求必须合并；更重要的是，**所有会消费当前 Refresh Token 的请求必须全局串行化**，不能只按订阅分锁。

---

### 6.7 模型网关

#### 请求

```http
POST /gateway/v1/chat/completions
Authorization: Bearer <employmentToken>
Content-Type: application/json
```

```json
{
  "model": "model-id",
  "messages": [
    {
      "role": "system",
      "content": "员工系统提示和必要上下文"
    },
    {
      "role": "user",
      "content": "请完成这个任务"
    }
  ],
  "temperature": 0.2,
  "max_tokens": 2000,
  "stream": true
}
```

#### 令牌要求

| 令牌 | 是否可用于网关 |
|---|---:|
| `employmentToken` | 是 |
| `accessToken` | 否 |
| `refreshToken` | 否 |
| `SUB2API_API_KEY` | 客户端绝对不能持有 |

#### 模型选择

`model` 必须来自当前订阅返回的 `allowedModels`。即使客户端本地有旧缓存，SEP 仍会在网关再次校验：

- 平台模型是否启用；
- 企业是否允许该模型；
- 订阅是否有效；
- 余额和额度是否足够。

#### 网关错误处理

| HTTP 状态 | 处理策略 |
|---:|---|
| `400` | 请求字段、模型或参数错误；修正请求，不盲目重试 |
| `401` | Employment Token 无效/过期；刷新一次后原请求最多重试一次 |
| `403` | 无授权、订阅失效、余额不足或企业状态不允许；刷新目录并停止当前运行 |
| `404` | 订阅/授权资源不存在；刷新目录并停止当前运行 |
| `429` | 使用 `Retry-After` 退避，最多有限重试 |
| `5xx` | 指数退避，最多有限重试；保留 requestId |
| 网络中断 | 标记为可恢复失败，不能将任务伪造为成功 |

#### 流式响应

当 `stream=true` 时，服务端返回 SSE：

```text
Content-Type: text/event-stream

 data: {"choices":[{"delta":{"content":"你好"}}]}

 data: {"choices":[{"delta":{"content":"，我可以帮助你。"}}]}

 data: {"choices":[],"usage":{"prompt_tokens":10,"completion_tokens":8,"total_tokens":18}}

 data: [DONE]
```

客户端必须：

1. 按空行拆分 SSE 帧；
2. 逐段追加 assistant 内容；
3. 收到 `[DONE]` 才标记正常完成；
4. 未收到 `[DONE]` 的断开只能标记为中断或可恢复失败；
5. 不把 Authorization header 写入调试日志。

---

## 7. Refresh Token 并发和状态机

### 7.1 为什么必须单飞

下面这种实现是错误的：

```text
请求 A 发现 accessToken 过期 → 使用 refreshToken-X
请求 B 发现 accessToken 过期 → 同时使用 refreshToken-X
```

Refresh Token 轮换后，只有第一个请求能成功。第二个请求会把同一 token 识别为重放，可能导致整个会话族被撤销。

### 7.2 建议实现

```ts
class AuthSessionManager {
  private accessToken: string | null = null;
  private refreshPromise: Promise<string> | null = null;
  private employmentPromises = new Map<string, Promise<string>>();
  private refreshRotationQueue = Promise.resolve();

  async refreshAccessToken(): Promise<string> {
    if (this.refreshPromise) return this.refreshPromise;

    this.refreshPromise = this.refreshRotationQueue =
      this.refreshRotationQueue.then(async () => {
        const refreshToken = await this.loadRefreshToken();
        if (!refreshToken) throw new AuthRequiredError();

        const response = await this.post('/client/auth/refresh', { refreshToken });
        await this.saveRefreshTokenAtomically(response.refreshToken);
        this.accessToken = response.accessToken;
        return response.accessToken;
      }).finally(() => {
        this.refreshPromise = null;
      });

    return this.refreshPromise;
  }

  async getEmploymentToken(subscriptionId: string): Promise<string> {
    const cached = this.getValidEmploymentToken(subscriptionId);
    if (cached) return cached;

    const existing = this.employmentPromises.get(subscriptionId);
    if (existing) return existing;

    const promise = this.refreshRotationQueue = this.refreshRotationQueue.then(async () => {
      const refreshToken = await this.loadRefreshToken();
      if (!refreshToken) throw new AuthRequiredError();

      const response = await this.post('/client/auth/token', {
        refreshToken,
        subscriptionId,
      });
      await this.saveRefreshTokenAtomically(response.refreshToken);
      this.cacheEmploymentToken(subscriptionId, response.employmentToken, response.expiresIn);
      return response.employmentToken;
    }).finally(() => this.employmentPromises.delete(subscriptionId));

    this.employmentPromises.set(subscriptionId, promise);
    return promise;
  }
}
```

实现时需注意：

- `refreshPromise` 负责合并普通 Access Token 刷新；
- `employmentPromises` 负责合并同一订阅的 Employment Token 刷新；
- `refreshRotationQueue` 负责串行化所有会轮换 Refresh Token 的操作；
- 生产代码应补充超时、取消、错误映射和进程退出处理；
- 不要把上面的示例直接复制为未经测试的生产代码。

### 7.3 原子保存建议

安全存储更新应遵循：

```text
读取旧值
  → 请求成功获得新值
  → 写临时安全存储记录
  → 校验写入成功
  → 替换当前 refreshToken
  → 删除临时记录
```

如果应用在替换过程中崩溃，下次启动应优先恢复已确认写入的新 token，避免继续使用已轮换的旧 token。

---

## 8. Electron IPC 设计建议

### 8.1 推荐 IPC 接口

```text
auth:login
  入参：email、password
  出参：脱敏后的 user、enterprise、登录状态

auth:refresh
  入参：无
  出参：登录状态，不返回 token

auth:logout
  入参：无
  出参：void

auth:required
  入参：无
  出参：是否需要登录

resources:list
  入参：无
  出参：订阅列表（不包含 token）

subscription:get-runtime
  入参：subscriptionId
  出参：运行时清单（不包含 token）

subscription:prepare
  入参：subscriptionId
  出参：是否可运行、员工摘要（不包含 token）
```

### 8.2 IPC 安全要求

- renderer 只通过 `contextBridge` 调用白名单 IPC；
- main 进程必须再次校验 `subscriptionId` 格式和长度；
- renderer 不应能指定任意 URL；
- renderer 不应能读取 `refreshToken`；
- renderer 不应能读取 `accessToken` 或 `employmentToken`；
- IPC 错误应返回稳定的业务状态，不返回带 token 的底层错误对象；
- 用户登出、设备吊销、refresh 失效时，由 main 主动发出 `auth-state-changed` 事件。

推荐返回：

```ts
interface PublicAuthState {
  authenticated: boolean;
  user: {
    id: string;
    email: string;
    name: string;
    role: string;
  } | null;
  enterprise: {
    id: string;
    name: string;
  } | null;
  reason?: 'logout' | 'refresh_expired' | 'device_revoked' | 'password_changed';
}
```

---

## 9. 微信/QQ OAuth 对客户端的影响

### 9.1 当前服务端 Web OAuth 路径

当前 Web 认证中心提供：

```http
GET /api/auth/oauth/wechat/start
GET /api/auth/oauth/qq/start
GET /api/auth/oauth/:provider/callback
```

成功后由服务端完成 Web 会话处理，并跳转 Web 前端：

```text
/oauth/callback?provider=wechat&status=success
/oauth/callback?provider=qq&status=success
```

这是浏览器 Cookie 会话流程，结果不是桌面端可直接使用的 `refreshToken`。

### 9.2 当前客户端不要做的事情

客户端暂时不要：

- 直接请求微信或 QQ 授权地址后自行解析 code；
- 把微信 `AppSecret` 或 QQ `AppKey` 打包进 Electron；
- 监听 Web `/oauth/callback` 页面并尝试读取 Web Cookie；
- 把微信/QQ授权 code 直接提交给 `/client/auth/login`；
- 假设 OAuth 登录成功后会自动得到桌面 Refresh Token；
- 用自定义 URI 接收回调但没有后端一次性 code 交换协议。

### 9.3 未来如果支持桌面微信/QQ登录

需要单独开发桌面 OAuth 闭环，建议采用：

```text
客户端点击微信/QQ登录
  → 系统浏览器打开授权页
  → 后端生成一次性 client login transaction
  → 微信/QQ回调后端
  → 后端生成一次性 exchange code
  → 本地 loopback / 自定义 URI / device code 回传客户端
  → 客户端用 exchange code 换 DESKTOP session
  → 服务端返回 accessToken + refreshToken
```

要求：

- 使用一次性 code 或 PKCE；
- exchange code 短时有效且只能使用一次；
- AppSecret/AppKey 只留在服务端；
- 不复用 Web `httpOnly` Cookie 作为桌面会话；
- 不把第三方 access token 当作 SEP access token；
- 需要新增明确的客户端 API 契约和安全测试。

在该能力正式开发前，客户端登录页应以邮箱密码为主，微信/QQ按钮可以隐藏、置灰或显示“即将支持”，不要伪造可用状态。

---

## 10. 密码找回和账号辅助流程

密码找回仍然是 Web 认证中心能力，相关接口为：

```http
POST /api/auth/password/forgot
POST /api/auth/password/reset
```

桌面客户端建议：

- 在登录页提供“忘记密码”按钮；
- 点击后使用系统浏览器打开 Web 的 `/forgot-password` 页面；
- 邮件中的重置链接打开 Web 的 `/reset-password?token=...` 页面；
- 用户重置密码后回到客户端重新登录；
- 不要在客户端自行实现密码重置 token 解析；
- 不要把邮箱重置 token 复制到客户端日志。

如果用户修改密码或在运营端被强制退出，原有桌面 session 可能失效。客户端收到 refresh `401` 后应清理登录态并要求重新登录。

---

## 11. 错误响应和统一处理

### 11.1 普通 API 错误结构

SEP 普通 API 错误通常包含：

```json
{
  "statusCode": 401,
  "message": "Invalid or expired refresh token",
  "requestId": "request-id",
  "timestamp": "2026-09-28T00:00:00.000Z",
  "path": "/api/client/auth/refresh"
}
```

客户端至少应保留：

- `statusCode`；
- `message`；
- `requestId`。

不要把完整错误对象直接展示给普通用户，也不要把其中可能存在的敏感请求信息写日志。

### 11.2 推荐客户端错误分类

```ts
type ClientAuthErrorCode =
  | 'INVALID_CREDENTIALS'
  | 'AUTH_REQUIRED'
  | 'DEVICE_REVOKED'
  | 'TOKEN_REPLAY'
  | 'SUBSCRIPTION_UNAVAILABLE'
  | 'RATE_LIMITED'
  | 'NETWORK_ERROR'
  | 'SERVER_ERROR';
```

客户端 UI 文案可以如下：

| 内部分类 | 建议文案 |
|---|---|
| `INVALID_CREDENTIALS` | 邮箱或密码错误 |
| `AUTH_REQUIRED` | 登录状态已失效，请重新登录 |
| `DEVICE_REVOKED` | 当前设备已被停用，请联系管理员 |
| `TOKEN_REPLAY` | 登录凭据已失效，请重新登录 |
| `SUBSCRIPTION_UNAVAILABLE` | 当前员工授权已失效，请刷新后重试 |
| `RATE_LIMITED` | 操作过于频繁，请稍后再试 |
| `NETWORK_ERROR` | 网络连接失败，请检查网络后重试 |
| `SERVER_ERROR` | 服务暂时不可用，请稍后再试 |

### 11.3 请求 ID

客户端应为每个请求保留自己的本地关联 ID，并记录服务端返回的 `requestId`。排查问题时向后端提供：

- 客户端版本；
- 操作名称；
- HTTP 方法和路径；
- HTTP 状态；
- 服务端 `requestId`；
- 时间；
- 脱敏后的错误摘要。

严禁提供：

- 密码；
- Refresh Token；
- Access Token；
- Employment Token；
- 微信/QQ密钥。

---

## 12. 客户端迁移清单

### 12.1 接口迁移

- [ ] Web `/api/auth/login` 已替换为 `/api/client/auth/login`；
- [ ] Web `/api/auth/refresh` 已替换为 `/api/client/auth/refresh`；
- [ ] Web `/api/auth/logout` 已替换为 `/api/client/auth/logout`；
- [ ] `/client/instances` 新代码已迁移为 `/client/subscriptions`；
- [ ] `instanceId` 新代码已迁移为 `subscriptionId`；
- [ ] `/client/auth/token` 请求体使用 `subscriptionId`；
- [ ] `/client/auth/token` 成功后保存返回的新 `refreshToken`；
- [ ] 网关使用 `employmentToken`，不是 `accessToken`。

### 12.2 令牌迁移

- [ ] Refresh Token 不再按 JWT 解析；
- [ ] Refresh Token 已迁移到 `safeStorage`/系统密钥链；
- [ ] Access Token 不落盘；
- [ ] Employment Token 不落盘；
- [ ] 普通刷新和换 Employment Token 均已加入全局串行队列；
- [ ] 同一请求不会重复使用旧 Refresh Token；
- [ ] refresh `401` 会清理所有登录凭据；
- [ ] 网络失败不会误删仍可能有效的 Refresh Token；
- [ ] 用户主动退出会停止正在发起的云端调用。

### 12.3 Electron 安全迁移

- [ ] renderer 没有直接 `fetch` SEP 的代码；
- [ ] renderer 没有导入 `electron`；
- [ ] renderer 没有读取任何 token；
- [ ] IPC 参数在 main 中二次校验；
- [ ] 日志脱敏过滤 Authorization、token、password；
- [ ] 崩溃上报不包含登录响应和请求 body；
- [ ] 客户端包内没有 `SUB2API_API_KEY`；
- [ ] 客户端包内没有微信 AppSecret 或 QQ AppKey。

---

## 13. 联调步骤

### 13.1 联调前准备

1. 准备测试账号和密码；
2. 确认 `SEP_API_BASE_URL` 指向测试环境；
3. 确认测试环境健康检查可用；
4. 为客户端生成稳定设备指纹；
5. 确认客户端版本号会随请求发送；
6. 打开客户端 main 进程脱敏日志；
7. 确认日志不会打印三种令牌。

### 13.2 最小登录联调

```bash
export SEP_API_BASE_URL='https://<测试域名>/api'

curl -i "$SEP_API_BASE_URL/client/auth/login" \
  -H 'Content-Type: application/json' \
  -d '{
    "email": "user@example.com",
    "password": "请使用测试账号密码",
    "fingerprint": "stable-device-fingerprint",
    "platform": "darwin",
    "clientVersion": "1.0.0"
  }'
```

不要把真实响应保存到 Git、公共日志或聊天记录。

### 13.3 刷新联调

使用登录响应中的 Refresh Token 调用：

```bash
curl -i "$SEP_API_BASE_URL/client/auth/refresh" \
  -H 'Content-Type: application/json' \
  -d '{
    "refreshToken": "<current-refresh-token>"
  }'
```

验证：

- 返回新的 `accessToken`；
- 返回新的 `refreshToken`；
- 再次使用旧 Refresh Token 应失败；
- 客户端已保存新 Refresh Token 后，下一次刷新仍成功。

### 13.4 订阅联调

```bash
curl -i "$SEP_API_BASE_URL/client/subscriptions" \
  -H 'Authorization: Bearer <access-token>'
```

如果返回空数组，不代表登录失败，通常表示当前测试账号还没有有效订阅或员工授权。

### 13.5 Employment Token 联调

```bash
curl -i "$SEP_API_BASE_URL/client/auth/token" \
  -H 'Content-Type: application/json' \
  -d '{
    "refreshToken": "<current-refresh-token>",
    "subscriptionId": "<subscription-id>"
  }'
```

验证：

- 返回 `employmentToken`；
- 返回新的 `refreshToken`；
- 客户端已覆盖旧值；
- Employment Token 不能用于普通订阅 API；
- Access Token 不能用于模型网关。

### 13.6 网关联调

```bash
curl -N "$SEP_API_BASE_URL/gateway/v1/chat/completions" \
  -H 'Authorization: Bearer <employment-token>' \
  -H 'Content-Type: application/json' \
  -d '{
    "model": "<allowed-model>",
    "messages": [
      {"role": "user", "content": "你好"}
    ],
    "stream": true
  }'
```

不要在 shell history、CI 日志或截图中留下真实 token。

---

## 14. 验收标准

### 14.1 正常流程

- [ ] 新用户可以输入邮箱密码登录；
- [ ] 登录成功后设备记录能被服务端识别；
- [ ] 重启客户端后可使用安全存储的 Refresh Token 恢复登录；
- [ ] Access Token 过期后自动刷新；
- [ ] 刷新后使用新 Refresh Token，不会触发 token replay；
- [ ] 登录成功后能够读取订阅列表；
- [ ] 选择订阅后能够获取 Employment Token；
- [ ] Employment Token 能调用模型网关；
- [ ] 流式响应能正确处理 `[DONE]`；
- [ ] 主动退出后本地令牌和缓存已清理。

### 14.2 异常流程

- [ ] 错误密码不会泄露邮箱是否存在；
- [ ] 设备被运营端吊销后，客户端最终会回到登录页；
- [ ] Refresh Token 网络失败不会被误删；
- [ ] Refresh Token 明确失效后会清理登录态；
- [ ] 两个普通请求同时触发刷新时只发一个刷新请求；
- [ ] 普通刷新与换 Employment Token 并发时不会复用同一个旧 Refresh Token；
- [ ] 订阅失效后不会继续使用本地缓存调用网关；
- [ ] 网关 `401` 不会无限重试；
- [ ] 网关 `403/404` 会刷新订阅目录并停止当前员工运行；
- [ ] 日志和错误上报不包含 token、密码或密钥。

### 14.3 兼容和迁移

- [ ] 新客户端不再依赖 `instanceId`；
- [ ] 旧服务返回 `expiresIn` 时，如确需兼容，客户端可暂时将其作为 Access Token 过期时间兜底；
- [ ] 新服务优先读取 `accessTokenExpiresIn` 和 `refreshTokenExpiresIn`；
- [ ] 不把旧版 JWT Refresh Token 示例当作当前实现；
- [ ] Web OAuth 不会被错误接入为桌面 OAuth。

---

## 15. 对后端和客户端团队的接口约定

### 后端必须保持

- `/api/client/auth/login` 返回桌面登录所需的两个令牌及有效期；
- `/api/client/auth/refresh` 和 `/api/client/auth/token` 的 Refresh Token rotation 语义；
- 旧 Refresh Token 重放时撤销对应 session family；
- `/api/client/subscriptions` 返回数组；
- `/api/client/auth/token` 接收 `subscriptionId`；
- 网关只接受 `type=client-employment` 的 Employment Token；
- 错误响应包含 HTTP 状态和 `requestId`。

### 客户端必须保持

- 不调用 Web 登录接口完成桌面登录；
- 不依赖 Cookie；
- 不在 renderer 保存令牌；
- 不在本地生成或伪造 Employment Token；
- 不绕过订阅列表直接猜测订阅 ID；
- 不绕过网关直接连接上游模型服务；
- 不因为微信/QQ暂时未配置而阻塞邮箱密码登录开发；
- 不在没有后端桌面 OAuth 交换协议时自行实现微信/QQ登录。

---

## 16. 当前版本边界

截至 2026-09-28：

1. 邮箱密码桌面登录接口已作为当前客户端正式接入基线；
2. 桌面设备注册、设备吊销、Refresh Token rotation 已纳入客户端必须适配的认证逻辑；
3. 订阅和 Employment Token 已从旧的实例语义收敛到 `subscriptionId`；
4. Web 端忘记密码、修改密码、邮箱验证能力不改变桌面登录接口；
5. 微信/QQ OAuth 后端和运营配置入口正在完善，第三方平台配置尚未完成；
6. 当前不承诺桌面端直接使用微信/QQ登录；
7. 后续如支持桌面 OAuth，必须新增独立的桌面 OAuth 设计、接口和安全验收，不得直接复用 Web Cookie 回调。

---

## 17. 一句话交付给客户端开发者

请把客户端认证实现调整为：

```text
Electron main 进程
  → /api/client/auth/login（邮箱密码 + 稳定设备指纹）
  → safeStorage 保存 refreshToken
  → 内存保存 accessToken
  → /api/client/subscriptions 获取授权订阅
  → /api/client/auth/token 使用 subscriptionId 换 employmentToken
  → /api/gateway/v1/chat/completions 使用 employmentToken 调模型
  → 所有 Refresh Token rotation 操作全局串行
  → renderer 永远不接触 token
```

微信和 QQ 当前未配置完成不会影响以上流程；先完成邮箱密码登录、订阅、Employment Token 和网关调用的客户端改造与联调即可。
