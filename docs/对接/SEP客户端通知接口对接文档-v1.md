# SEP 客户端通知接口对接文档 v1

**版本**：v1.0  
**日期**：2026-10-08  
**适用客户端**：sep-client 桌面客户端  
**维护方**：SEP 平台后端

---

## 1. 对接结论

SEP 已有通知客户端接口，本次**不新增一套重复的 `/client/notifications` REST API**：

- 通知 REST API 使用现有的 `/api/notifications`；
- 通知实时推送使用现有的 `/ws/notifications` WebSocket；
- 桌面客户端登录后使用 `POST /api/client/auth/login` 返回的 `accessToken` 调用上述接口；
- `refreshToken` 只用于刷新 access token，`employmentToken` 只用于调用员工模型网关，二者都不能用于通知接口。

本次后端已补齐客户端联调所需的边界：

1. 通知 WebSocket 与客户端 access token 使用同一套 `ACCESS_JWT_SECRET`；
2. WebSocket 只接受 `type: "access"` 的普通 access token；
3. 支持客户端实际发送的 `{ "type": "ping" }` 心跳并返回 `pong`；
4. 原生 Electron/Node 客户端没有 `Origin` 时允许继续进入 JWT 认证流程；有 `Origin` 时仍校验白名单；
5. 通知列表和查询参数增加统一校验，避免非法分页参数进入数据库。

---

## 2. 环境与基础地址

客户端配置一个带 `/api` 的 HTTP API 地址：

```text
SEP_API_BASE_URL=https://sep.example.com/api
```

HTTP 请求示例：

```text
https://sep.example.com/api/notifications
```

WebSocket 地址**不带 `/api`**：

```text
wss://sep.example.com/ws/notifications
```

本地开发示例：

```text
HTTP API:  http://localhost:3001/api
WebSocket: ws://localhost:3001/ws/notifications
```

如果部署在反向代理之后，必须确保代理同时转发：

- `/api/*` → SEP HTTP API；
- `/ws/notifications` → SEP WebSocket，并开启 Upgrade/Connection 转发。

---

## 3. 认证

### 3.1 获取 access token

客户端登录接口：

```http
POST /api/client/auth/login
Content-Type: application/json
```

登录成功后保存响应中的：

```json
{
  "accessToken": "<access-token>",
  "refreshToken": "<refresh-token>",
  "accessTokenExpiresIn": 3600
}
```

通知 REST 请求统一携带：

```http
Authorization: Bearer <accessToken>
```

### 3.2 token 使用边界

| Token | 通知 REST | 通知 WebSocket | 说明 |
|---|---:|---:|---|
| `accessToken` | ✅ | ✅ | 客户端通知接口唯一使用的 token |
| `refreshToken` | ❌ | ❌ | 仅调用 `/api/client/auth/refresh` |
| `employmentToken` | ❌ | ❌ | 仅调用 `/api/gateway/v1/chat/completions` 等员工运行接口 |

access token 失效时，客户端应先刷新 token，再重试一次原请求；不要把 token 放到 WebSocket URL 查询参数中。

---

## 4. 通知数据结构

通知对象的核心字段如下：

```ts
interface Notification {
  id: string;
  userId?: string;
  type:
    | 'INFO'
    | 'SUCCESS'
    | 'WARNING'
    | 'ERROR'
    | 'SUBSCRIPTION_REQUEST_CREATED'
    | 'SUBSCRIPTION_REQUEST_APPROVED'
    | 'SUBSCRIPTION_REQUEST_REJECTED'
    | 'SKILL_VERSION_UPDATED'
    | 'ALLOWANCE_WARNING'
    | 'ALLOWANCE_EXHAUSTED'
    | 'WALLET_LOW_BALANCE'
    | 'CONTRIBUTION_ENTERPRISE_APPROVED'
    | 'CONTRIBUTION_ENTERPRISE_REJECTED'
    | 'CONTRIBUTION_PLATFORM_APPROVED'
    | 'CONTRIBUTION_PLATFORM_REJECTED'
    | 'CONTRIBUTION_REWARD_CREDITED'
    | 'SUBSCRIPTION_EXPIRING';
  title: string;
  message: string;
  relatedType: string | null;
  relatedId: string | null;
  read: boolean;
  category: 'SYSTEM' | 'USAGE_ALERT' | 'SECURITY' | 'APPROVAL';
  severity: 'INFO' | 'WARNING' | 'ERROR';
  actionUrl: string | null;
  createdAt: string; // ISO 8601
}
```

### 4.1 分类

| `category` | 含义 | 典型通知 |
|---|---|---|
| `SYSTEM` | 系统、技能、订阅生命周期 | 技能版本更新、订阅即将到期 |
| `USAGE_ALERT` | 额度和钱包告警 | 额度预警、额度耗尽、钱包余额偏低 |
| `SECURITY` | 安全事件 | 预留分类，当前安全事件类型按版本逐步接入 |
| `APPROVAL` | 申请和审核 | 员工使用申请、贡献审核结果 |

当前没有 `BILLING` 分类。客户端不要根据旧文档或旧实现发送/筛选 `BILLING`，应使用 `USAGE_ALERT` 或 `SYSTEM`。

---

## 5. REST 接口

### 5.1 查询通知列表

```http
GET /api/notifications?limit=50&offset=0&category=APPROVAL&unreadOnly=false
Authorization: Bearer <accessToken>
```

查询参数：

| 参数 | 类型 | 必填 | 默认值 | 说明 |
|---|---|---:|---:|---|
| `limit` | integer | 否 | `50` | 每页数量，范围 `1-100` |
| `offset` | integer | 否 | `0` | 偏移量，不能小于 `0` |
| `category` | enum | 否 | 无 | `SYSTEM` / `USAGE_ALERT` / `SECURITY` / `APPROVAL` |
| `unreadOnly` | boolean | 否 | `false` | URL 中使用字符串 `true` 或 `false` |

成功响应：`200 OK`

```json
{
  "items": [
    {
      "id": "clx_notification_1",
      "userId": "user_1",
      "type": "SUBSCRIPTION_REQUEST_CREATED",
      "title": "新的使用申请",
      "message": "姚瑞泉申请订阅「商品内容与详情页策划」",
      "relatedType": "subscription_request",
      "relatedId": "request_1",
      "read": false,
      "category": "APPROVAL",
      "severity": "INFO",
      "actionUrl": "/subscriptions/requests/request_1",
      "createdAt": "2026-10-08T08:30:00.000Z"
    }
  ],
  "total": 1
}
```

> 重要：响应是 `{ items, total }`，不是直接返回数组。客户端 SDK 不要把响应直接强转为 `Notification[]`。

### 5.2 查询未读数量

```http
GET /api/notifications/unread-count
GET /api/notifications/unread-count?category=APPROVAL
Authorization: Bearer <accessToken>
```

成功响应：`200 OK`

```json
{
  "count": 3
}
```

### 5.3 标记单条已读

```http
POST /api/notifications/:id/read
Authorization: Bearer <accessToken>
```

成功响应：`204 No Content`，没有响应 body。

### 5.4 标记全部已读

```http
POST /api/notifications/read-all
POST /api/notifications/read-all?category=APPROVAL
Authorization: Bearer <accessToken>
```

成功响应：`204 No Content`，没有响应 body。

### 5.5 删除单条通知

```http
DELETE /api/notifications/:id
Authorization: Bearer <accessToken>
```

成功响应：`204 No Content`，没有响应 body。

### 5.6 清空已读通知

```http
DELETE /api/notifications/clear-read
DELETE /api/notifications/clear-read?category=SYSTEM
Authorization: Bearer <accessToken>
```

成功响应：`204 No Content`，没有响应 body。

### 5.7 REST 错误处理

| 状态码 | 含义 | 客户端处理 |
|---:|---|---|
| `400` | 分类、分页或布尔查询参数不合法 | 修正请求，不重试原请求 |
| `401` | access token 失效/缺失，或通知服务拒绝鉴权 | 经认证管理器刷新后最多重试一次；再次通知 401 只降级通知，不清会话。只有刷新凭据明确过期、撤销或刷新端点明确拒绝才回登录；刷新网络、5xx、超时保留会话 |
| `5xx` | 服务端或网络异常 | 短暂退避后重试，通知列表以本地缓存为准 |

对于 `204`，客户端必须以 HTTP 状态码判断成功，不能无条件调用 `response.json()`。

---

## 6. WebSocket 实时通知

### 6.1 建立连接与认证

```ts
const ws = new WebSocket('wss://sep.example.com/ws/notifications');

ws.onopen = () => {
  // 连接建立后 5 秒内发送首条消息
  ws.send(JSON.stringify({ type: 'auth', token: accessToken }));
};
```

认证消息格式：

```json
{
  "type": "auth",
  "token": "<accessToken>"
}
```

服务端不会从 URL 查询参数读取 token。桌面客户端通常没有 `Origin`，服务端会继续要求 JWT 认证；如果客户端主动携带 `Origin`，该来源必须在服务端 `CORS_ORIGIN` 白名单中。

### 6.2 服务端消息

#### 连接认证成功

```json
{
  "type": "connected",
  "data": {
    "unreadCount": 3
  },
  "timestamp": 1791448200000
}
```

收到 `connected` 后，客户端可以用 `data.unreadCount` 更新角标，并建议补拉一次 REST 列表。

#### 新通知

```json
{
  "type": "notification",
  "data": {
    "id": "clx_notification_1",
    "type": "SUBSCRIPTION_REQUEST_CREATED",
    "title": "新的使用申请",
    "message": "姚瑞泉申请订阅「商品内容与详情页策划」",
    "read": false,
    "category": "APPROVAL",
    "severity": "INFO",
    "actionUrl": "/subscriptions/requests/request_1",
    "createdAt": "2026-10-08T08:30:00.000Z"
  },
  "timestamp": 1791448200000
}
```

#### 未读数变化

```json
{
  "type": "unread_count",
  "data": {
    "count": 4
  },
  "timestamp": 1791448200000
}
```

#### 心跳响应

```json
{
  "type": "pong",
  "timestamp": 1791448230000
}
```

### 6.3 客户端心跳

客户端建议每 30 秒发送：

```json
{
  "type": "ping",
  "timestamp": 1791448230000
}
```

服务端返回 `pong`。客户端不需要把 `pong` 写入通知列表。

### 6.4 断线重连与补偿

WebSocket 不是通知的唯一数据源，通知最终以 REST 数据为准。客户端必须实现：

1. 连接断开后指数退避重连，建议最大间隔 30 秒；
2. 每次重连成功后重新发送 `auth`，不能复用已关闭的连接状态；
3. 重连成功后调用：
   - `GET /api/notifications?limit=50&offset=0`；
   - `GET /api/notifications/unread-count`；
4. 收到 `notification` 时按 `id` 去重；
5. access token 刷新后，关闭旧连接并用新 token 建立连接；
6. 首次明确 Token 拒绝（握手 `401`、`4401` 或 `1008 / Invalid token`、`1008 / Authentication required`）经认证管理器受控强刷一次；重复通知拒绝只进入退避，不据此全局登出，不在每次退避中强刷。只有认证管理器明确确认刷新凭据失效才重新登录。

服务端内部查询失败使用 `1011 / Internal error`，不等同于 Token 无效。`Origin not allowed`、认证等待超时、网络和心跳故障也不能触发全局登出。收到 `connected` 才表示认证完成，此时执行 REST 补偿；多设备已读／删除引起的 `unread_count` 事件也应补偿列表与分类计数。

推荐的通知同步策略：

```text
登录成功 → 拉取 REST 列表/未读数 → 建立 WebSocket
WebSocket connected → 再拉一次 REST 列表/未读数
收到 notification → upsert 本地通知 + 更新未读数
收到 unread_count → 更新角标
断线/重连 → 重新认证 + REST 补拉
```

---

## 7. 客户端实现示例

### 7.1 REST 请求封装

```ts
interface NotificationPage {
  items: Notification[];
  total: number;
}

async function request<T>(
  path: string,
  accessToken: string,
  init: RequestInit = {},
): Promise<T | undefined> {
  const response = await fetch(`${SEP_API_BASE_URL}${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${accessToken}`,
      ...(init.body ? { 'Content-Type': 'application/json' } : {}),
      ...init.headers,
    },
  });

  if (!response.ok) {
    throw new Error(`SEP API ${response.status}: ${await response.text()}`);
  }

  if (response.status === 204) return undefined;
  return response.json() as Promise<T>;
}

const page = await request<NotificationPage>(
  '/notifications?limit=50&offset=0&unreadOnly=false',
  accessToken,
);

await request<void>('/notifications/read-all', accessToken, { method: 'POST' });
```

### 7.2 WebSocket 最小示例

```ts
function connectNotifications(accessToken: string) {
  const ws = new WebSocket(`${SEP_WS_BASE_URL}/ws/notifications`);

  ws.onopen = () => {
    ws.send(JSON.stringify({ type: 'auth', token: accessToken }));
  };

  ws.onmessage = (event) => {
    const message = JSON.parse(event.data);
    switch (message.type) {
      case 'connected':
        syncNotificationsFromRest();
        break;
      case 'notification':
        upsertNotification(message.data);
        break;
      case 'unread_count':
        updateUnreadBadge(message.data.count);
        break;
      case 'pong':
        break;
    }
  };

  const heartbeat = setInterval(() => {
    if (ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({ type: 'ping', timestamp: Date.now() }));
    }
  }, 30_000);

  ws.onclose = () => {
    clearInterval(heartbeat);
    scheduleReconnectWithBackoff();
  };

  return () => {
    clearInterval(heartbeat);
    ws.close();
  };
}
```

---

## 8. 与现有客户端代码对接时的检查项

如果客户端已有 `platform-api` 封装，请重点检查以下四项：

- `listNotifications()` 的返回类型应为 `{ items, total }`，不能声明为 `Notification[]`；
- `markNotificationRead()`、`markAllNotificationsRead()`、`deleteNotification()`、`clearReadNotifications()` 成功时是 `204`，不能无条件解析 JSON；
- 分类使用 `SYSTEM`、`USAGE_ALERT`、`SECURITY`、`APPROVAL`，不要使用旧的 `BILLING`；
- WebSocket 心跳和认证字段使用 `type`：`auth`、`ping`，不是 `event`。

---

## 9. 联调验收清单

- [ ] 客户端能用 `/api/client/auth/login` 获取 `accessToken`；
- [ ] `GET /api/notifications` 返回 `200`，并正确读取 `items` 和 `total`；
- [ ] `GET /api/notifications/unread-count` 能更新通知角标；
- [ ] 单条已读、全部已读、删除、清空已读能正确处理 `204`；
- [ ] WebSocket 连接后 5 秒内发送 `auth`；
- [ ] 能收到 `connected`、`notification`、`unread_count`；
- [ ] 客户端发送 `ping` 后能收到 `pong`；
- [ ] 断线重连会重新认证并补拉 REST 数据；
- [ ] access token 刷新后不会继续使用旧 WebSocket 连接；
- [ ] 审批、额度、系统通知在 Web 端产生后，客户端能通过 REST/WS 看到；
- [ ] 不把 refresh token、employment token 或完整 token 放入 URL、日志和通知正文。
