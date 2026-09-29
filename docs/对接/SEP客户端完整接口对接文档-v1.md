# SEP 客户端头像、企业 Logo 与算力钱包接口对接文档

- **文档版本**：v1.0
- **适用客户端**：SEP 桌面客户端
- **更新时间**：2026-09-29
- **接口前缀**：`/api`

> 本文包含以下四部分：
>
> 1. 用户头像和企业 Logo；
> 2. 企业算力额度与个人钱包余额；
> 3. 个人充值、订单查询和对账；
> 4. 意图识别所需的员工目录、员工授权申请和 Skill 版本提交接口。
>
> 登录、Token 刷新、Employment Token、Gateway、SSE、任务镜像等内容请以其他客户端对接文档为准。本文件涉及的头像/Logo、算力和钱包、充值订单，以及员工目录、员工授权申请和 Skill 版本提交接口均以当前后端实现为准。

## 1. 通用约定

### 1.1 Base URL

以下示例中的 `${API_BASE_URL}` 替换为实际服务端地址，例如：

```text
https://api.example.com
```

接口完整地址示例：

```text
${API_BASE_URL}/api/client/profile
```

### 1.2 鉴权

除特别标明为“公开图片读取”的接口外，均使用客户端登录后获得的 `accessToken`：

```http
Authorization: Bearer <accessToken>
```

`refreshToken` 不能代替 `accessToken` 调用以下业务接口。

### 1.3 请求和金额

- JSON 请求使用 `Content-Type: application/json`。
- 文件上传使用 `Content-Type: multipart/form-data`，字段名为 `file`。
- 金额单位均为人民币“元”。
- 请求金额字段（例如 `amountCNY`）使用 JSON number；响应中的金额字段通常使用字符串，避免浮点误差。
- 展示金额可格式化为两位小数，但不要用客户端计算结果覆盖服务端返回的余额或订单状态。
- 服务端根据当前登录用户确定数据范围，客户端不要在请求中传 `userId` 或 `enterpriseId` 试图切换查看对象。

### 1.4 通用错误

| HTTP 状态 | 含义 | 客户端处理 |
| --- | --- | --- |
| `400` | 参数错误、文件格式错误或订单状态不允许当前操作 | 提示用户修正或根据订单状态处理 |
| `401` | `accessToken` 无效或过期 | 按现有认证流程刷新 Token，失败后回到登录页 |
| `403` | 无权限，例如非企业管理员上传 Logo | 提示无权限，不要重复请求 |
| `404` | 资源、图片或订单不存在 | 头像/Logo 可回退占位图；订单提示订单不存在 |
| `413` | 上传文件超过大小限制 | 提示压缩图片后重试 |
| `503` | 支付渠道未配置或暂不可用 | 提示稍后重试或联系管理员 |

---

## 2. 用户头像和企业 Logo

### 2.1 推荐资料接口

```http
GET /api/client/profile
Authorization: Bearer <accessToken>
```

该接口返回当前登录用户的资料和服务端解析出的企业归属，是客户端启动后或进入个人中心时获取头像、Logo 的推荐接口。

成功响应 `200`：

```json
{
  "user": {
    "id": "user_cuid",
    "email": "user@example.com",
    "name": "张三",
    "avatar": "/api/users/avatars/2f4d0e87-7f68-4a2b-9e9e-6a7b8c9d0e1f.webp",
    "role": "USER"
  },
  "enterprise": {
    "id": "enterprise_cuid",
    "name": "示例公司",
    "logo": "/api/enterprise/logos/3a6f3e4a-3b68-4a3a-a49d-2f0a5c5d9a11.png"
  }
}
```

字段说明：

| 字段 | 类型 | 说明 |
| --- | --- | --- |
| `user.avatar` | `string \| null` | 用户头像路径；没有头像时为 `null` |
| `enterprise` | `object \| null` | 当前用户所属企业；无企业归属时为 `null` |
| `enterprise.logo` | `string \| null` | 企业 Logo 路径；企业未设置 Logo 时为 `null` |

当前接口按服务端的企业成员关系返回企业，不接受客户端传入 `enterpriseId`。

### 2.2 图片地址拼接和读取

`avatar`、`logo` 是 API 路径，不是完整 URL。客户端应使用 `${API_BASE_URL}` 拼接：

```text
avatarUrl = ${API_BASE_URL} + user.avatar
logoUrl   = ${API_BASE_URL} + enterprise.logo
```

例如：

```text
https://api.example.com/api/users/avatars/2f4d0e87-7f68-4a2b-9e9e-6a7b8c9d0e1f.webp
https://api.example.com/api/enterprise/logos/3a6f3e4a-3b68-4a3a-a49d-2f0a5c5d9a11.png
```

公开图片读取接口：

```http
GET /api/users/avatars/:filename
GET /api/enterprise/logos/:filename
```

这两个接口不要求 `Authorization`，用于桌面端图片组件直接读取。客户端必须使用服务端返回的路径，不要自行拼接存储目录、修改文件名或把本地路径传给服务端。

接口成功返回图片二进制内容，并带有正确的 `Content-Type`。图片不存在或已被替换时返回 `404`，客户端应显示默认头像/Logo。

服务端设置了公开缓存（当前为 1 天）。客户端可以使用 HTTP 缓存；当资料接口返回新的文件路径时，应丢弃旧图片缓存并加载新地址。

### 2.3 上传用户头像

```http
POST /api/users/me/avatar
Authorization: Bearer <accessToken>
Content-Type: multipart/form-data
```

表单字段：

| 字段 | 类型 | 必填 | 说明 |
| --- | --- | --- | --- |
| `file` | file | 是 | PNG、JPEG 或 WebP 图片，最大 2 MB |

示例（伪代码）：

```text
form = new FormData()
form.append("file", imageFile)
POST ${API_BASE_URL}/api/users/me/avatar
```

成功响应 `201` 示例：

```json
{
  "avatar": "/api/users/avatars/new-avatar.webp"
}
```

上传成功后，客户端使用返回的 `avatar` 路径刷新头像；也可以重新调用 `GET /api/client/profile` 同步完整资料。

### 2.4 上传企业 Logo

```http
POST /api/enterprise/logo
Authorization: Bearer <accessToken>
Content-Type: multipart/form-data
```

表单字段与头像上传相同：

| 字段 | 类型 | 必填 | 说明 |
| --- | --- | --- | --- |
| `file` | file | 是 | PNG、JPEG 或 WebP 图片，最大 2 MB |

该接口只允许当前企业管理员调用。非企业管理员返回 `403`。

成功响应 `201` 示例：

```json
{
  "logo": "/api/enterprise/logos/new-logo.png"
}
```

上传成功后，客户端使用返回的 `logo` 路径更新界面，并重新调用 `GET /api/client/profile` 获取最终资料。

### 2.5 空值和刷新规则

- `user.avatar === null`：显示默认头像或用户名首字母。
- `enterprise === null`：不显示企业 Logo 区域，或显示默认企业图标。
- `enterprise.logo === null`：显示默认企业 Logo。
- 图片读取返回 `404`：不要循环重试，显示占位图，并在下一次资料刷新时重新获取路径。
- 客户端启动、用户切换账号、上传成功、从后台恢复时，可调用一次 `GET /api/client/profile`。
- 不要把头像或 Logo 的二进制内容写入业务数据库；只保存服务端返回的路径或使用本地 HTTP 缓存。

---

## 3. 企业算力额度与个人钱包余额

### 3.1 推荐聚合接口

```http
GET /api/client/compute-balance
Authorization: Bearer <accessToken>
```

该接口一次返回当前用户的企业算力额度和个人钱包余额。成功响应 `200` 示例：

```json
{
  "enterprise": {
    "userId": "user_cuid",
    "name": "张三",
    "email": "user@example.com",
    "departmentName": "研发部",
    "limitCNY": "300.00",
    "period": "MONTH",
    "periodLabel": "每月",
    "carryOver": true,
    "enabled": true,
    "carriedInCNY": "0.00",
    "usedCNY": "35.4200",
    "remainingCNY": "264.5800",
    "topUpRemainingCNY": "50.00",
    "totalRemainingCNY": "314.5800",
    "usedPct": 12,
    "periodStart": "2026-09-01T00:00:00.000Z",
    "resetAt": "2026-10-01T00:00:00.000Z",
    "dailyLimitCNY": null,
    "dailyUsedCNY": "0.0000",
    "dailyRemainingCNY": null,
    "monthlyLimitCNY": "300.00",
    "monthlyUsedCNY": "35.4200",
    "monthlyRemainingCNY": "264.5800",
    "topUpAmountCNY": "50.00",
    "topUpConsumedCNY": "0.00"
  },
  "personal": {
    "balanceCNY": "10.00",
    "totalDepositCNY": "20.00",
    "totalConsumeCNY": "10.00"
  }
}
```

无企业归属用户的响应：

```json
{
  "enterprise": null,
  "personal": {
    "balanceCNY": "0.00",
    "totalDepositCNY": "0.00",
    "totalConsumeCNY": "0.00"
  }
}
```

### 3.2 两类账本的含义

#### `enterprise`：企业承担的额度

`enterprise` 表示企业为当前成员提供的算力资金和额度窗口：

- `limitCNY`：当前周期的常规额度上限；`null` 表示未设置上限/不限额。
- `usedCNY`：当前周期已使用的企业承担金额，不包含用户个人钱包自费金额。
- `remainingCNY`：常规额度（含结转）剩余金额；不限额时为 `null`。
- `topUpRemainingCNY`：企业为该成员追加的、跨周期保留的额度余额。
- `totalRemainingCNY`：当前企业侧可用总余额；不限额时可能为 `null`。
- `resetAt`：当前周期结束和额度重置时间。
- `period`：额度周期，例如 `DAY`、`WEEK`、`MONTH`、`QUARTER`、`YEAR`。

#### `personal`：用户自费钱包

`personal` 是当前用户自己的钱包，与企业账本隔离：

- `balanceCNY`：当前个人钱包余额。
- `totalDepositCNY`：累计充值金额。
- `totalConsumeCNY`：累计个人钱包消费金额。

### 3.3 不要直接把两类余额相加

客户端必须分别展示“企业额度”和“个人余额”，不要直接计算或展示一个未经产品确认的 `availableCNY`：

```text
企业额度 != 个人钱包余额
```

两者的资金归属、使用顺序、统计口径不同。企业额度耗尽时，系统可能根据扣费规则改由个人钱包承担；是否允许本次对话不能只由客户端本地余额相加判断，最终以服务端扣费结果为准。

`usedCNY` 也不要与 `personal.totalConsumeCNY` 相加后再回写任意余额字段。

### 3.4 刷新时机

客户端建议在以下时机调用 `GET /api/client/compute-balance`：

1. 登录完成或恢复会话后；
2. 打开“我的算力/钱包”页面时；
3. 充值订单确认已支付/已入账后；
4. 一次对话或任务结束后需要刷新余额时；
5. 从后台恢复到前台时。

服务端余额可能因对话扣费、支付异步通知或管理员调整而变化，客户端不要长时间只使用本地缓存。

### 3.5 可选的细分查询接口

如果客户端需要展示更详细的页面，可直接调用：

```http
GET /api/compute-credit/my-allowance
Authorization: Bearer <accessToken>
```

```http
GET /api/personal-wallet
Authorization: Bearer <accessToken>
```

聚合接口已经包含这两个接口的核心数据；普通客户端优先使用 `/api/client/compute-balance`，避免同一页面产生不一致的刷新时序。

---

## 4. 个人充值、订单查询和对账

### 4.1 创建个人充值订单

```http
POST /api/personal-wallet/recharge
Authorization: Bearer <accessToken>
Content-Type: application/json
```

请求体：

```json
{
  "amountCNY": 10.00
}
```

字段说明：

| 字段 | 类型 | 必填 | 约束 |
| --- | --- | --- | --- |
| `amountCNY` | number | 是 | 大于 0，最多 100000 元，最多 2 位小数 |
| `returnUrl` | string | 否 | 支付完成后回跳的合法 URL；不传则使用服务端默认结果页 |

请求示例：

```json
{
  "amountCNY": 10.00,
  "returnUrl": "https://client.example.com/personal-recharge/result"
}
```

成功响应 `201` 示例：

```json
{
  "orderId": "personal-recharge-order-cuid",
  "orderNo": "PRC20260929153000123456",
  "amountCNY": "10.00",
  "payUrl": "<支付宝支付表单 HTML>"
}
```

注意：当前 `payUrl` 字段实际承载的是支付宝支付表单内容，不一定是可直接 `window.open` 的普通 URL。客户端应按照支付模块约定渲染/提交该表单；不要把 `payUrl` 当作余额到账结果。

**创建订单不等于充值到账。** 创建成功时订单通常为 `PENDING`，个人钱包不会因为创建订单而立即增加余额。余额只有在支付异步通知或后续对账确认支付后才会入账。

### 4.2 查询个人充值订单

```http
GET /api/personal-wallet/recharge/:orderNo
Authorization: Bearer <accessToken>
```

例如：

```http
GET /api/personal-wallet/recharge/PRC20260929153000123456
```

成功响应 `200` 示例：

```json
{
  "orderNo": "PRC20260929153000123456",
  "amountCNY": "10.00",
  "status": "PAID",
  "payChannel": "ALIPAY",
  "paidAt": "2026-09-29T15:32:10.000Z",
  "createdAt": "2026-09-29T15:30:00.000Z"
}
```

订单状态：

| 状态 | 含义 | 客户端处理 |
| --- | --- | --- |
| `PENDING` | 已创建，尚未确认支付/入账 | 等待支付结果；必要时调用对账接口 |
| `PAID` | 已确认支付并完成钱包入账 | 重新查询算力余额和个人钱包 |
| `CLOSED` | 订单已关闭，不再自动入账 | 不要继续轮询或自行加余额，联系业务方处理 |

订单查询只允许查询当前登录用户自己的订单。其他用户订单号和不存在的订单都会按 `404` 处理。

### 4.3 主动对账

```http
POST /api/personal-wallet/recharge/:orderNo/reconcile
Authorization: Bearer <accessToken>
```

例如：

```http
POST /api/personal-wallet/recharge/PRC20260929153000123456/reconcile
```

该接口用于处理“支付平台已经收款，但异步通知延迟或丢失”的情况。接口会向支付渠道查询真实状态；如果确认已支付，会幂等地完成订单履约和钱包入账。

已支付订单再次对账不会重复入账：

```json
{
  "status": "PAID",
  "reconciled": false
}
```

仍未确认支付：

```json
{
  "status": "PENDING",
  "reconciled": false
}
```

本次对账发现已支付并完成补偿入账：

```json
{
  "status": "PAID",
  "reconciled": true
}
```

`reconciled: true` 只表示本次请求触发了补偿履约，不代表客户端可以直接计算余额。对账后仍要重新调用余额接口。

### 4.4 客户端充值流程

推荐流程：

```text
1. POST /api/personal-wallet/recharge
   └─ 获取 orderNo 和 payUrl/payForm

2. 客户端展示或提交支付表单

3. 支付完成后，使用 orderNo 查询订单
   GET /api/personal-wallet/recharge/:orderNo

4. 如果仍为 PENDING，可等待支付通知后再次查询，
   或调用一次主动对账：
   POST /api/personal-wallet/recharge/:orderNo/reconcile

5. 对账后再次查询订单，确认 status === PAID

6. 重新获取余额：
   GET /api/client/compute-balance
   必要时同时调用 GET /api/personal-wallet

7. 使用服务端返回的 personal.balanceCNY 更新页面
```

客户端禁止：

- 创建订单后直接把 `amountCNY` 加到本地余额；
- 仅依据支付页面关闭、支付平台回跳或客户端本地状态判断已到账；
- 在订单为 `PENDING` 时展示为可用余额；
- 因对账接口返回 `reconciled: true` 就跳过余额重新查询；
- 对同一个订单并发发起大量对账请求。建议间隔轮询，并在成功后停止。

### 4.5 充值后的流水查询

如果客户端需要显示个人钱包流水：

```http
GET /api/personal-wallet/transactions?page=1&pageSize=20
Authorization: Bearer <accessToken>
```

成功响应示例：

```json
{
  "total": 2,
  "page": 1,
  "pageSize": 20,
  "totalPages": 1,
  "records": [
    {
      "id": "transaction-cuid",
      "type": "DEPOSIT",
      "amountCNY": "10.0000",
      "balanceAfterCNY": "20.0000",
      "description": "个人充值 PRC20260929153000123456",
      "relatedType": "PERSONAL_RECHARGE",
      "relatedId": "personal-recharge-order-cuid",
      "createdAt": "2026-09-29T15:32:10.000Z"
    }
  ]
}
```

当前个人钱包流水类型以服务端返回值为准；充值入账类型为 `DEPOSIT`，不要在客户端强行改名为 `RECHARGE`。金额为正数表示入账，为负数表示出账。

---

## 5. 客户端联调清单

### 5.1 头像和企业 Logo

- [ ] 使用 `GET /api/client/profile` 获取 `user.avatar` 和 `enterprise.logo`。
- [ ] 使用 `${API_BASE_URL}` 拼接服务端返回的图片路径。
- [ ] 正确处理 `null`、`enterprise: null` 和图片 `404`。
- [ ] 上传头像使用 `POST /api/users/me/avatar`，字段名为 `file`。
- [ ] 上传企业 Logo 使用 `POST /api/enterprise/logo`，仅企业管理员可用。
- [ ] 上传成功后使用接口返回的新路径，并刷新资料缓存。

### 5.2 企业额度和个人钱包

- [ ] 使用 `GET /api/client/compute-balance` 获取聚合余额。
- [ ] 分开显示 `enterprise` 和 `personal`，不直接相加。
- [ ] `limitCNY`、`remainingCNY` 为 `null` 时按“不限额”处理，不当作 0。
- [ ] 充值、对话扣费、回到前台后重新刷新服务端余额。
- [ ] 不把旧的 Token 数值或其他用量字段当成人民币余额。

### 5.3 个人充值、订单和对账

- [ ] 创建充值订单后保存 `orderNo`，不要本地加余额。
- [ ] 根据支付模块约定展示/提交 `payUrl` 中的支付表单。
- [ ] 支付后查询订单；`PENDING` 时等待或调用对账接口。
- [ ] 对账接口可重复调用，但应控制轮询频率。
- [ ] 只有订单 `PAID` 且重新查询余额后，才更新个人钱包展示。
- [ ] 订单 `CLOSED` 时停止自动重试。

## 6. 服务端实现位置

```text
backend/src/modules/client/client.controller.ts
backend/src/modules/client/client.service.ts
backend/src/modules/users/user.controller.ts
backend/src/modules/enterprise/enterprise-logo.controller.ts
backend/src/modules/compute-credit/compute-credit.controller.ts
backend/src/modules/compute-credit/member-allowance-query.service.ts
backend/src/modules/personal-wallet/personal-wallet.controller.ts
backend/src/modules/personal-wallet/personal-wallet.service.ts
backend/src/modules/payment/personal-recharge.controller.ts
backend/src/modules/payment/payment.service.ts
```

---

## 7. 意图识别与员工能力扩展接口

本节补充客户端自动编排需要的接口。除模型 Gateway 外，以下接口均使用普通 `accessToken`，不能使用 `employmentToken`。

### 7.1 客户端自动编排流程

客户端不应直接让模型选择一个员工并立即执行，推荐按以下顺序处理：

```text
用户输入任务目标
  ↓
识别用户意图并拆解所需能力
  ↓
查询当前用户已授权且有效的订阅
  ↓
查询企业员工目录
  ↓
企业没有可用员工时查询平台员工目录
  ↓
按优先级匹配员工，或提交授权/使用申请
  ↓
申请批准后重新查询订阅
  ↓
仅使用有效订阅生成执行 DAG
```

员工匹配优先级：

1. 当前用户已授权且状态有效的员工；
2. 当前企业存在、但当前用户尚未授权的员工；
3. SEP 平台公开且可申请的员工。

> 企业目录和平台目录只用于候选匹配，不能直接换取 `employmentToken` 或执行任务。只有订阅接口返回的有效订阅，才能进入执行 DAG。

### 7.2 通用约定

```http
Authorization: Bearer <accessToken>
Content-Type: application/json
```

企业 ID、用户 ID、成员 ID、申请人 ID 和审批人 ID 均由服务端根据 Token 推导，客户端不得在请求中传入或伪造。

本节接口建议沿用统一错误结构：

```json
{
  "statusCode": 400,
  "message": "请求参数不合法",
  "requestId": "req_xxx",
  "timestamp": "2026-09-29T08:30:00.000Z",
  "path": "/api/client/employee-access-requests"
}
```

| HTTP 状态 | 含义 |
| --- | --- |
| `400` | 参数格式或业务参数不合法 |
| `401` | `accessToken` 无效或已过期 |
| `403` | 当前用户无权访问该功能 |
| `404` | 员工、订阅或版本不存在，或当前用户不可见 |
| `409` | 重复申请、幂等键冲突、状态冲突或版本冲突 |
| `422` | 请求格式正确，但业务条件不满足 |
| `429` | 请求频率超过限制 |

### 7.3 平台员工目录（已提供）

接口由 `ClientController` 提供，需使用普通 `accessToken`。当前仅返回 `APPROVED` 平台员工，且使用字段白名单，不包含 system prompt、模型配置和 Skill 正文。

#### 请求

```http
GET /api/client/platform-employees
Authorization: Bearer <accessToken>
```

查询参数：

| 参数 | 类型 | 必填 | 说明 |
| --- | --- | --- | --- |
| `keyword` | string | 否 | 按员工名称、职位、简介或行业搜索（当前不搜索能力名称） |
| `capabilityId` | string | 否 | 按能力 ID 精确筛选 |
| `functionalCategory` | string | 否 | 按枚举筛选：`TECH`、`PRODUCT_DESIGN`、`MARKETING_GROWTH`、`ECOMMERCE`、`SALES_CUSTOMER`、`OPERATIONS_ORG`、`FINANCE_LEGAL` |
| `page` | integer | 否 | 从 `1` 开始，默认 `1` |
| `pageSize` | integer | 否 | 默认 `20`，最大 `100` |
| `sort` | string | 否 | `updatedAt_desc`（默认）、`createdAt_desc`、`name_asc` |

示例：

```http
GET /api/client/platform-employees?keyword=数据分析&page=1&pageSize=20
Authorization: Bearer <accessToken>
```

约束：

- 不接受 `enterpriseId`、`memberId` 或 `userId` 作为查询范围；
- 只返回平台公开且可申请的员工；
- 不返回 system prompt、模型密钥、内部包地址、私有 Skill 正文等敏感信息；
- 返回能力摘要即可，客户端不需要把 Skill 全文发送给意图识别模型。

#### 成功响应 `200`

```json
{
  "items": [
    {
      "employeeId": "platform-employee-data-analysis",
      "name": "数据分析员工",
      "avatar": null,
      "avatarAsset": null,
      "position": "数据分析师",
      "description": "负责业务数据分析、趋势判断和分析报告生成",
      "functionalCategory": "TECH",
      "employeeStatus": "APPROVED",
      "availability": "AVAILABLE",
      "canApply": true,
      "capabilities": [
        {
          "id": "capability-data-analysis",
          "name": "数据分析",
          "description": "分析结构化业务数据并输出结论",
          "type": "SKILL"
        }
      ],
      "updatedAt": "2026-09-20T08:30:00.000Z"
    }
  ],
  "page": 1,
  "pageSize": 20,
  "total": 1,
  "hasNextPage": false
}
```

主要字段：

| 字段 | 类型 | 说明 |
| --- | --- | --- |
| `employeeId` | string | 平台数字员工模板 ID，全局稳定，用于展示和申请 |
| `name` | string | 员工名称 |
| `avatar` | string/null | 兼容头像字段；如为路径，按本文头像/Logo规则拼接 Base URL |
| `avatarAsset` | object/null | 可选的新头像资源 |
| `position` | string | 员工职位 |
| `description` | string | 员工能力简介 |
| `functionalCategory` | string/null | 职能分类 |
| `employeeStatus` | string | 平台员工模板发布状态 |
| `availability` | string | 建议值：`AVAILABLE`、`UNAVAILABLE`、`OFFLINE` |
| `canApply` | boolean | 当前用户/企业是否可以提交申请 |
| `capabilities` | array | 能力摘要，不包含 Skill 全文 |
| `updatedAt` | string | ISO 8601 更新时间 |

### 7.4 员工授权/使用申请（已提供）

接口由 `ClientController` 提供，底层复用 `SubscriptionRequest` 审批流程。服务端从 access token 解析申请用户和企业成员，不接受客户端传入身份或企业 ID。

#### 创建申请

```http
POST /api/client/employee-access-requests
Authorization: Bearer <accessToken>
Idempotency-Key: employee-access-request-xxxxxxxx
Content-Type: application/json
```

`Idempotency-Key` 建议使用 `16` 到 `128` 个 ASCII 字符。网络失败或响应丢失时必须复用原 Key 重试，不要生成新 Key，否则可能创建重复申请。

企业已有员工但当前用户没有授权时，请求体示例：

```json
{
  "targetType": "ENTERPRISE_SUBSCRIPTION",
  "subscriptionId": "enterprise-subscription-data-analysis",
  "employeeId": null,
  "reason": "当前任务需要数据分析和趋势判断能力",
  "requestedCapabilities": [
    "capability-data-analysis",
    "capability-trend-analysis"
  ]
}
```

申请平台员工时，请求体示例：

```json
{
  "targetType": "PLATFORM_EMPLOYEE",
  "subscriptionId": null,
  "employeeId": "platform-employee-data-analysis",
  "reason": "当前企业没有可以完成市场数据分析的员工",
  "requestedCapabilities": [
    "capability-data-analysis"
  ]
}
```

请求字段：

| 字段 | 类型 | 必填 | 说明 |
| --- | --- | --- | --- |
| `targetType` | string | 是 | `ENTERPRISE_SUBSCRIPTION` 或 `PLATFORM_EMPLOYEE` |
| `subscriptionId` | string/null | 条件必填 | `ENTERPRISE_SUBSCRIPTION` 时必填 |
| `employeeId` | string/null | 条件必填 | `PLATFORM_EMPLOYEE` 时必填 |
| `reason` | string | 是 | 申请原因，建议最多 2000 字符 |
| `requestedCapabilities` | string[] | 否 | 任务所需能力 ID，建议最多 32 个 |

约束：

- `targetType=ENTERPRISE_SUBSCRIPTION` 时必须提供当前企业中 ACTIVE 订阅的 `subscriptionId`；服务端由订阅反查员工。多余的 `employeeId` 不参与申请目标判定；
- `targetType=PLATFORM_EMPLOYEE` 时必须提供 `employeeId`，并且员工当前必须处于 `APPROVED`；`subscriptionId` 不参与目标判定；
- 服务端必须重新校验目标员工状态、企业关系和当前授权，不能直接信任客户端之前的目录结果；
- 相同用户、相同企业、相同员工存在 `PENDING` 申请时，底层申请服务会返回 `409`；
- `Idempotency-Key` 必填。相同 Key、同一用户且请求指纹相同时返回原申请；Key 已用于其他用户或不同请求内容时返回 `409`。
- 客户端不提交企业 ID、申请人 ID、成员 ID 或审批人 ID。

#### 创建成功响应 `201`

```json
{
  "requestId": "employee-access-request-001",
  "status": "PENDING",
  "targetType": "ENTERPRISE_SUBSCRIPTION",
  "employee": {
    "employeeId": "employee-data-analysis",
    "subscriptionId": "enterprise-subscription-data-analysis",
    "name": "数据分析员工"
  },
  "requestedCapabilities": [
    "capability-data-analysis",
    "capability-trend-analysis"
  ],
  "createdAt": "2026-09-29T08:30:00.000Z",
  "updatedAt": "2026-09-29T08:30:00.000Z",
  "message": "申请已提交，等待企业管理员处理"
}
```

相同 `Idempotency-Key` 且请求内容相同的重试返回同一个 `requestId` 和申请记录；相同 Key 但请求内容不同返回 `409`。请求字段校验失败或缺少 Key 返回 `400`。当前状态查询只允许申请人本人访问，记录不存在或不属于本人均返回 `404`。

#### 查询申请状态

```http
GET /api/client/employee-access-requests/:requestId
Authorization: Bearer <accessToken>
```

当前状态映射：`PENDING`、`APPROVED`、`REJECTED`、`CANCELLED`（数据库 `CANCELED` 映射为客户端拼写）。底层申请审批目前由企业管理员处理，不提供 `EXPIRED`、`FULFILLED` 状态。

| 状态 | 含义 |
| --- | --- |
| `PENDING` | 等待企业管理员或平台审核 |
| `APPROVED` | 已批准，应刷新订阅目录 |
| `REJECTED` | 已拒绝 |
| `CANCELLED` | 已取消 |

申请批准后，客户端必须重新请求当前用户订阅列表。当前后端已存在的订阅列表路径是：

```http
GET /api/subscriptions
Authorization: Bearer <accessToken>
```

只有订阅列表中出现状态有效的订阅后，才可以继续获取 Employment Token 和执行任务。不要直接把申请响应中的员工对象当作可执行员工。

### 7.5 Skill 修改版本提交（当前已提供）

客户端编辑 Skill 后，可以把完整原文保存为个人版本并原子提交企业审核。当前后端已提供该接口：

```http
POST /api/enterprise/skill-versions
Authorization: Bearer <accessToken>
Idempotency-Key: 902a70ec-b23d-4ec0-82c8-73450fe778a9
Content-Type: application/json
```

请求体：

```json
{
  "capabilityId": "capability-data-analysis",
  "parentVersionId": "platform-skill-version-data-analysis-v1",
  "content": "---\nname: data-analysis\ndescription: 数据分析\n---\n\n# 工作方法\n先确认数据范围，再进行分析。\n",
  "changeSummary": "补充数据范围确认步骤"
}
```

字段说明：

| 字段 | 类型 | 必填 | 约束 |
| --- | --- | --- | --- |
| `capabilityId` | string | 是 | `1-128` 个字符 |
| `parentVersionId` | string | 是 | 必须属于同一能力且可继承 |
| `content` | string | 是 | 完整 Skill 原文，`1-500000` 个字符 |
| `changeSummary` | string | 否 | 最多 2000 个字符 |

`content` 必须原样保存，包括 YAML frontmatter、Markdown、换行符、尾部空白和 Unicode 字符。客户端不能先 Markdown 渲染、trim、替换换行或截断正文。

成功响应 `201` 示例：

```json
{
  "id": "psv_4f7d...",
  "capabilityId": "capability-data-analysis",
  "parentVersionId": "platform-skill-version-data-analysis-v1",
  "enterpriseId": "enterprise-001",
  "ownerId": "user-001",
  "scope": "PERSONAL",
  "version": "0.0.0-personal.4f7d...",
  "status": "PENDING_ENTERPRISE_REVIEW",
  "changeSummary": "补充数据范围确认步骤",
  "submittedAt": "2026-09-29T08:30:00.000Z",
  "enterpriseReviewedAt": null,
  "rejectionReason": null,
  "createdAt": "2026-09-29T08:30:00.000Z",
  "updatedAt": "2026-09-29T08:30:00.000Z",
  "content": "---\nname: data-analysis\ndescription: 数据分析\n---\n\n# 工作方法\n先确认数据范围，再进行分析。\n"
}
```

> `ownerId`、`enterpriseId`、`scope`、`version` 和 `status` 由服务端生成，客户端不能在请求体中传入。响应可以展示或本地记录这些字段。

状态：

- `PENDING_ENTERPRISE_REVIEW`：等待企业管理员审核；
- `ENTERPRISE_APPROVED`：企业审核通过，仅表示当前用户的个人版本获准使用；
- `ENTERPRISE_REJECTED`：企业驳回，客户端通过版本查询接口读取 `rejectionReason`。

幂等和权限要求：

- 相同用户、相同 `Idempotency-Key`、相同请求内容重试，返回同一个版本；
- 相同 Key 但 `content`、`parentVersionId` 或其他请求内容变化，返回 `409`；
- 已提交审核的版本不能原地修改，用户再次编辑必须生成新的 Key 并创建新版本；
- 当前用户必须属于企业，并且对该能力有有效员工订阅和使用授权；
- `parentVersionId` 必须属于同一 `capabilityId`，且父版本对当前用户可见、状态允许继承。

Skill 版本相关现有查询接口：

```http
GET /api/enterprise/skill-versions?capabilityId=<capabilityId>
GET /api/enterprise/skill-versions/:versionId/preview
```

其中版本列表返回当前用户可见的版本和审核状态；preview 返回已授权版本的正文。企业管理员审核接口不应暴露给普通用户：

```http
GET /api/enterprise/skill-version-reviews
POST /api/enterprise/skill-versions/:versionId/review
```

### 7.6 客户端调用示例

#### 自动编排匹配员工

```text
1. GET /api/subscriptions
2. 在已授权且有效的订阅中按能力匹配
3. GET /api/enterprise/overview，查看企业员工目录
4. 企业有匹配员工但当前用户不可用：
   POST /api/client/employee-access-requests
5. 企业没有匹配员工：
   GET /api/client/platform-employees
6. 找到平台候选员工后：
   POST /api/client/employee-access-requests
7. 申请批准或完成后，重新 GET /api/subscriptions
8. 重新识别意图、规划步骤并生成执行 DAG
```

#### Skill 修改提交

```text
1. 读取当前用户可见的 Skill 版本
2. 用户编辑完整 Skill 原文
3. 本地保存待上传内容
4. POST /api/enterprise/skill-versions
5. PENDING_ENTERPRISE_REVIEW 时显示待审核
6. 网络失败时使用原 Idempotency-Key 重试
7. 审核通过后重新读取版本并选择使用
```

### 7.7 本节接口验收清单

- [ ] 平台员工目录支持关键词、能力筛选和分页；
- [ ] 平台目录只返回能力摘要，不返回 Skill 全文和敏感字段；
- [ ] 未授权员工不能换取 `employmentToken`；
- [ ] 员工授权申请支持企业订阅和平台员工两种目标；
- [ ] 重复申请和幂等重试不会产生重复记录；
- [ ] 申请批准后 `/api/subscriptions` 能返回新的有效订阅；
- [ ] Skill 提交保留完整原文；
- [ ] Skill 提交首次状态为 `PENDING_ENTERPRISE_REVIEW`；
- [ ] 相同 Key 重试返回同一版本，不同内容返回 `409`；
- [ ] 无有效员工授权时拒绝 Skill 提交；
- [ ] 客户端不传入 `enterpriseId`、`userId`、`memberId`、`ownerId` 或 `status`。

## 8. 新增接口的服务端实现位置

已实现位置：

```text
backend/src/modules/client/client.controller.ts
backend/src/modules/client/client.service.ts
backend/src/shared/client-employee.dto.ts
backend/src/modules/subscription-request/subscription-request.service.ts
backend/prisma/migrations/20260929120000_add_client_employee_access_requests/migration.sql
```

已提供接口：

```text
GET  /api/client/platform-employees
POST /api/client/employee-access-requests
GET  /api/client/employee-access-requests/:requestId
```

Skill 版本提交仍由以下现有模块提供：

```text
backend/src/modules/skill-version/skill-version.controller.ts
backend/src/modules/skill-version/personal-skill-submission.service.ts
backend/src/shared/skill-version.dto.ts
```
