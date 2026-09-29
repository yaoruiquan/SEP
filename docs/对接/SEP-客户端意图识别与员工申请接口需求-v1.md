# SEP 客户端意图识别与员工能力扩展接口需求-v1

日期：2026-09-29

本文用于 SEP 平台方开发或确认客户端自动编排所需的三个接口能力：

1. 平台员工目录接口；
2. 员工授权/使用申请接口；
3. Skill 修改版本提交接口。

接口路径均相对于 SEP API 基地址，例如：

```text
https://<sep-host>/api
```

除模型网关外，以下接口均使用普通 `accessToken`，不能使用 `employmentToken`。

---

## 1. 客户端当前业务流程

客户端自动编排不是直接让模型选择一个员工，而是按照以下顺序处理：

```text
用户输入任务目标
  ↓
识别用户意图
  ↓
拆解执行步骤和所需能力
  ↓
查询当前用户已授权员工
  ↓
查询企业员工目录
  ↓
查询 SEP 平台员工目录
  ↓
按优先级匹配员工
  ↓
生成可执行编排，或提示申请授权/招聘员工
```

员工匹配优先级：

1. 当前用户已授权且状态有效的员工；
2. 当前企业存在、但当前用户尚未授权的员工；
3. SEP 平台可申请的员工。

只有 `/client/subscriptions` 返回的有效订阅，才能直接进入执行 DAG。企业目录或平台目录中的员工只能作为候选人，不能直接换取 `employmentToken` 或执行任务。

客户端只需要员工能力摘要，不需要把 Skill Markdown 全文发送给意图识别模型。Skill 全文仅在员工实际执行时由客户端按现有员工包/Skill 加载流程使用。

---

## 2. 通用接口约定

### 2.1 认证

```http
Authorization: Bearer <accessToken>
Content-Type: application/json
```

`accessToken` 对应当前登录用户。企业 ID、用户 ID、成员 ID 必须由 SEP 根据 Token 推导，客户端不会在请求中传入，也不能信任客户端传入的这些字段。

### 2.2 通用错误格式

所有失败响应建议保持现有客户端约定：

```json
{
  "statusCode": 400,
  "message": "请求参数不合法",
  "requestId": "req_xxx",
  "timestamp": "2026-09-29T08:30:00.000Z",
  "path": "/api/client/employee-catalog"
}
```

建议状态码：

| 状态码 | 含义 |
|---:|---|
| `400` | 参数格式或业务参数不合法 |
| `401` | accessToken 无效或已过期 |
| `403` | 当前用户无权访问该功能 |
| `404` | 目标员工、订阅或版本不存在，或当前用户不可见 |
| `409` | 幂等键冲突、重复申请、状态冲突或版本冲突 |
| `422` | 请求格式正确，但业务条件不满足 |
| `429` | 请求频率超过限制 |
| `500` | SEP 内部错误 |

客户端会保留 `requestId` 用于问题定位；平台不要在 `message` 中返回 Token、密码、system prompt 或其他敏感信息。

---

# 3. 平台员工目录接口

## 3.1 接口用途

返回当前登录用户能够搜索到的 SEP 平台员工目录，用于：

- 企业内没有匹配员工时，搜索平台候选员工；
- 根据员工能力摘要辅助自动编排意图识别；
- 展示推荐员工并引导用户提交申请。

该接口返回的是平台目录候选人，不代表当前用户或当前企业已经订阅，也不代表可以直接执行。

## 3.2 请求

```http
GET /client/platform-employees
Authorization: Bearer <accessToken>
```

推荐查询参数：

| 参数 | 类型 | 必填 | 说明 |
|---|---|---:|---|
| `keyword` | string | 否 | 按员工名称、职位、简介或能力名称搜索 |
| `capabilityId` | string | 否 | 按能力 ID 精确筛选 |
| `functionalCategory` | string | 否 | 按职能分类筛选 |
| `page` | integer | 否 | 页码，从 `1` 开始，默认 `1` |
| `pageSize` | integer | 否 | 每页数量，建议默认 `20`，最大 `100` |
| `sort` | string | 否 | 建议支持 `relevance`、`name`、`updatedAt` |

示例：

```http
GET /client/platform-employees?keyword=数据分析&page=1&pageSize=20
Authorization: Bearer <accessToken>
```

### 约束

- `page` 必须大于等于 `1`；
- `pageSize` 建议限制在 `1` 到 `100`；
- 不允许客户端传入 `enterpriseId`、`memberId` 或 `userId` 作为查询范围；
- 只返回平台公开且可申请的员工；
- 不返回员工的 system prompt、模型密钥、内部包地址、私有 Skill 正文或内部管理字段。

## 3.3 成功响应

```http
200 OK
```

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
      "functionalCategory": "数据分析",
      "employeeStatus": "APPROVED",
      "availability": "AVAILABLE",
      "canApply": true,
      "capabilities": [
        {
          "id": "capability-data-analysis",
          "name": "数据分析",
          "description": "分析结构化业务数据并输出结论",
          "type": "ABILITY"
        },
        {
          "id": "capability-trend-analysis",
          "name": "趋势判断",
          "description": "根据历史数据识别趋势并说明依据",
          "type": "ABILITY"
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

## 3.4 字段定义

### 员工字段

| 字段 | 类型 | 必填 | 说明 |
|---|---|---:|---|
| `employeeId` | string | 是 | 平台数字员工模板 ID，全局稳定 |
| `name` | string | 是 | 员工名称 |
| `avatar` | string/null | 是 | 兼容旧头像字段，直接返回完整 URL |
| `avatarAsset` | object/null | 否 | 新头像资源；包含 `id`、`version`、`portraitUrl`、`faceUrl` |
| `position` | string | 是 | 员工职位 |
| `description` | string | 是 | 员工能力简介 |
| `functionalCategory` | string | 否 | 职能分类 |
| `employeeStatus` | string | 是 | 员工模板发布状态，建议仅返回可公开使用的状态 |
| `availability` | string | 是 | 建议值：`AVAILABLE`、`UNAVAILABLE`、`OFFLINE` |
| `canApply` | boolean | 是 | 当前用户/企业是否可以提交申请 |
| `updatedAt` | string | 是 | 目录更新时间，ISO 8601 |

### `capabilities` 字段

| 字段 | 类型 | 必填 | 说明 |
|---|---|---:|---|
| `id` | string | 是 | 能力 ID |
| `name` | string | 是 | 能力名称 |
| `description` | string | 是 | 能力摘要，用于模型匹配 |
| `type` | string | 是 | 能力类型 |

`capabilities` 只返回能力摘要，不返回 Skill 全文。能力描述应适合直接提供给意图识别模型，避免包含内部实现细节。

## 3.5 可见性和安全要求

- 只返回平台允许公开展示和申请的员工；
- 不泄露其他企业的授权关系、成员关系、消费信息或企业私有配置；
- `employeeId` 可以用于展示和申请，但不能单独用于换取 `employmentToken`；
- 员工实际执行前，客户端仍然只接受 `/client/subscriptions` 返回的 `subscriptionId`。

---

# 4. 员工授权/使用申请接口

## 4.1 接口用途

当自动编排发现某个步骤需要的能力无法由当前用户已授权员工完成时，客户端按以下顺序处理：

1. 如果企业目录中存在匹配员工，但 `currentUserCanUse` 为 `false`，提交企业内员工授权申请；
2. 如果平台目录中存在匹配员工，提交平台员工使用/订阅申请；
3. 申请成功或管理员处理完成后，客户端重新请求 `/client/subscriptions`，再重新规划任务。

未获授权的员工不能直接进入执行队列。

## 4.2 请求

```http
POST /client/employee-access-requests
Authorization: Bearer <accessToken>
Idempotency-Key: employee-access-request-xxxxxxxx
Content-Type: application/json
```

请求体：

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

平台员工申请示例：

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

### 请求字段

| 字段 | 类型 | 必填 | 说明 |
|---|---|---:|---|
| `targetType` | string | 是 | `ENTERPRISE_SUBSCRIPTION` 或 `PLATFORM_EMPLOYEE` |
| `subscriptionId` | string/null | 条件必填 | `ENTERPRISE_SUBSCRIPTION` 时必填 |
| `employeeId` | string/null | 条件必填 | `PLATFORM_EMPLOYEE` 时必填 |
| `reason` | string | 是 | 申请原因，建议最长 `2000` 字符 |
| `requestedCapabilities` | string[] | 否 | 任务需要的能力 ID，建议最多 `32` 个 |

约束：

- `targetType=ENTERPRISE_SUBSCRIPTION` 时，只允许传 `subscriptionId`，`employeeId` 必须为 `null` 或省略；
- `targetType=PLATFORM_EMPLOYEE` 时，只允许传 `employeeId`，`subscriptionId` 必须为 `null` 或省略；
- 企业 ID、申请人 ID、成员 ID、审批人 ID 不由客户端传入；
- 平台必须重新校验目标员工状态、企业关系和当前授权，不信任客户端之前的目录结果；
- 相同用户、相同企业、相同目标存在未结束申请时，不能创建重复申请；
- `Idempotency-Key` 建议长度为 `16` 到 `128` 个 ASCII 字符。

## 4.3 成功响应

首次创建：

```http
201 Created
```

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

相同 `Idempotency-Key` 使用完全相同请求重试时，应返回同一个 `requestId` 和当前最新状态，不得创建重复申请。建议返回 `200 OK` 或 `201 Created`，但响应结构必须一致。

## 4.4 申请状态

建议状态值：

| 状态 | 含义 |
|---|---|
| `PENDING` | 等待企业管理员或平台审核 |
| `APPROVED` | 已批准，客户端应刷新订阅目录 |
| `REJECTED` | 已拒绝 |
| `CANCELLED` | 已取消 |
| `EXPIRED` | 申请已过期 |
| `FULFILLED` | 已完成订阅或授权，已生成可用订阅 |

建议提供申请状态查询接口：

```http
GET /client/employee-access-requests/:requestId
Authorization: Bearer <accessToken>
```

如果平台暂时不提供查询接口，重复调用上述 POST 时也必须返回同一申请的当前状态。

## 4.5 审批完成后的客户端处理

平台批准申请后，客户端不会直接把申请响应当作可执行员工，而是重新调用：

```http
GET /client/subscriptions
```

只有新员工出现在该接口并且状态为 `ACTIVE`，客户端才会：

1. 获取员工技能摘要；
2. 重新执行意图识别和步骤匹配；
3. 生成新的 DAG；
4. 在用户确认后执行任务。

---

# 5. Skill 修改版本提交接口

## 5.1 当前客户端逻辑

客户端已经按照以下方式实现 Skill 修改：

1. 用户编辑 Skill；
2. 客户端先把完整原文持久化到本地；
3. 调用 SEP 创建个人 Skill 版本并送审；
4. 网络失败或响应丢失时保留本地待上传记录；
5. 重试时使用同一个 `Idempotency-Key`；
6. 审核通过后，客户端才允许将该版本作为远程可用版本使用。

因此平台接口必须保证：

- 保存和送审一次完成；
- 请求具有幂等性；
- 完整保留 Skill 原文；
- 不由客户端传入 `ownerId`、`enterpriseId`、`status`；
- 审核中的版本不能原地修改，修改必须创建新版本。

## 5.2 请求

```http
POST /enterprise/skill-versions
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

### 请求字段

| 字段 | 类型 | 必填 | 约束 |
|---|---|---:|---|
| `capabilityId` | string | 是 | `1-128` 字符 |
| `parentVersionId` | string | 是 | 必须属于同一能力，且是允许继承的已发布版本 |
| `content` | string | 是 | `1-500000` 字符，完整 Skill 原文 |
| `changeSummary` | string | 否 | 最长 `2000` 字符 |

### `content` 保留要求

平台必须原样保存：

- YAML frontmatter；
- Markdown 内容；
- 换行符；
- 尾部空白；
- 原文中的 Unicode 字符。

禁止：

- Markdown 渲染后再保存；
- 自动删除 frontmatter；
- 自动 trim；
- 替换换行符；
- 截断内容；
- 将 Skill 内容当作脚本执行。

## 5.3 权限校验

平台应从 accessToken 推导当前用户、企业和成员身份，并校验：

1. 当前用户属于某个企业；
2. 当前用户对 `capabilityId` 对应的 Skill 具有有效员工订阅和使用授权；
3. `parentVersionId` 属于同一 `capabilityId`；
4. 父版本属于以下允许来源之一：
   - 已发布平台版本；
   - 当前企业已发布企业版本；
   - 当前用户在当前企业的个人版本；
5. 父版本状态允许被继承；
6. 当前用户不能通过请求体伪造 `ownerId`、`enterpriseId`、`scope` 或 `status`。

## 5.4 成功响应

```http
201 Created
```

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
  "submittedAt": "2026-09-29T08:30:00.000Z",
  "enterpriseReviewedAt": null,
  "rejectionReason": null,
  "changeSummary": "补充数据范围确认步骤",
  "createdAt": "2026-09-29T08:30:00.000Z",
  "updatedAt": "2026-09-29T08:30:00.000Z"
}
```

响应中的 `ownerId` 和 `enterpriseId` 可以返回给客户端展示或记录，但不能由客户端指定。

## 5.5 幂等要求

### 相同请求重试

相同用户、相同 `Idempotency-Key`、相同请求内容再次提交：

```http
200 OK 或 201 Created
```

返回第一次创建的同一个版本 ID，不得创建多个版本。

### 相同 Key 修改内容

相同 `Idempotency-Key` 但 `content`、`parentVersionId` 或其他请求内容发生变化：

```http
409 Conflict
```

示例：

```json
{
  "statusCode": 409,
  "message": "同一幂等键不能提交不同的 Skill 内容",
  "requestId": "req_xxx",
  "timestamp": "2026-09-29T08:30:00.000Z",
  "path": "/api/enterprise/skill-versions"
}
```

### 审核中版本再次修改

不能直接修改已经提交审核的版本。用户再次编辑时，客户端会使用新的 `Idempotency-Key` 创建新的个人版本。

## 5.6 状态要求

推荐状态：

```text
PENDING_ENTERPRISE_REVIEW
ENTERPRISE_APPROVED
ENTERPRISE_REJECTED
```

首次提交后必须进入：

```text
PENDING_ENTERPRISE_REVIEW
```

平台审核通过后进入：

```text
ENTERPRISE_APPROVED
```

平台驳回后进入：

```text
ENTERPRISE_REJECTED
```

驳回时必须保存驳回原因，客户端通过版本查询接口展示该原因。审核通过只表示当前用户的个人版本获准使用，不自动发布为企业公共版本或平台版本。

## 5.7 与现有 Skill 接口的关系

该提交接口需要与以下现有接口保持一致：

```http
GET /enterprise/employees/:employeeId/skills
GET /enterprise/skill-versions?capabilityId=<capabilityId>
GET /enterprise/skill-versions/:versionId/preview
GET /enterprise/skill-version-reviews
POST /enterprise/skill-versions/:versionId/review
```

其中：

- 员工技能接口返回当前员工绑定的能力和当前版本；
- Skill 版本列表接口返回当前用户可见的版本；
- preview 接口返回完整原文；
- review 接口由企业管理员使用；
- 客户端不会把审核接口暴露给普通用户。

## 5.8 错误要求

| 场景 | 建议状态码 |
|---|---:|
| accessToken 无效 | `401` |
| 无企业成员身份 | `403` |
| Skill 或父版本不可见 | `404` |
| 参数缺失、内容为空或超长 | `400` |
| 父版本能力不匹配 | `400` |
| 幂等键冲突 | `409` |
| 版本已提交且不可原地修改 | `409` |
| 当前用户没有该 Skill 的有效员工授权 | `404` 或 `403` |

没有权限和资源不存在可以统一返回 `404`，避免泄露不可见资源是否存在；但错误结构必须保持一致。

---

# 6. 客户端完整调用示例

## 6.1 自动编排匹配员工

```text
1. GET /client/subscriptions
2. 在已授权员工中按能力匹配
3. 不足时 GET /enterprise/overview
4. 企业有匹配员工但 currentUserCanUse=false：
   POST /client/employee-access-requests
5. 企业没有匹配员工时：
   GET /client/platform-employees
6. 找到平台候选员工后：
   POST /client/employee-access-requests
7. 申请批准后重新 GET /client/subscriptions
8. 重新规划并生成执行 DAG
```

## 6.2 Skill 修改

```text
1. GET /enterprise/employees/:employeeId/skills
2. GET /enterprise/skill-versions?capabilityId=...
3. GET /enterprise/skill-versions/:versionId/preview
4. 用户编辑 Skill 原文
5. 本地保存完整内容
6. POST /enterprise/skill-versions
7. PENDING_ENTERPRISE_REVIEW 时显示待审核
8. 网络失败时使用原 Idempotency-Key 重试
9. 审核通过后重新读取版本并选择使用
```

## 6.3 重要边界

- 未授权员工不能换取 `employmentToken`；
- 平台目录员工不能直接执行任务；
- 客户端不提交 enterpriseId、userId、memberId、ownerId 或 status；
- 客户端不把 Skill 全文发送给意图识别模型；
- 只有 `GET /client/subscriptions` 返回的有效订阅才可以进入执行 DAG；
- Skill 提交成功不等于审核通过；
- 审核通过不等于企业公共 Skill 发布；
- 申请批准后必须重新刷新订阅目录，不能直接相信申请响应中的员工状态。

---

# 7. 平台方验收清单

## 7.1 平台员工目录

- [ ] 未登录访问返回 `401`；
- [ ] 支持关键词和能力筛选；
- [ ] 支持分页；
- [ ] 返回稳定的 `employeeId`；
- [ ] 返回能力摘要但不返回 Skill 全文和敏感字段；
- [ ] 能正确区分 `AVAILABLE` 与不可申请员工；
- [ ] 不泄露其他企业的授权关系。

## 7.2 员工授权申请

- [ ] 企业员工和平台员工都能表达申请目标；
- [ ] 服务器根据 Token 推导申请人和企业；
- [ ] 重复申请不会产生多条未结束记录；
- [ ] 相同幂等键重试返回同一个申请；
- [ ] 申请状态包含 `PENDING`、`APPROVED`、`REJECTED` 等状态；
- [ ] 批准后 `/client/subscriptions` 能返回新的有效订阅；
- [ ] 未批准前不能换取 employment token。

## 7.3 Skill 修改提交

- [ ] 请求一次完成创建个人版本和进入审核队列；
- [ ] 完整保留 Skill 原文；
- [ ] 相同幂等键重试返回同一个版本；
- [ ] 相同幂等键提交不同内容返回 `409`；
- [ ] 提交后状态为 `PENDING_ENTERPRISE_REVIEW`；
- [ ] 审核通过后状态为 `ENTERPRISE_APPROVED`；
- [ ] 驳回时保存 `rejectionReason`；
- [ ] 已提交版本不可原地修改；
- [ ] 无有效员工授权时拒绝提交。

---

# 8. 需要 SEP 平台方确认的事项

1. 平台员工目录接口最终路径是否采用 `/client/platform-employees`；
2. 平台员工目录是否允许普通企业成员读取公开能力摘要；
3. 员工授权申请是否同时支持企业订阅申请和平台员工申请；
4. 企业员工授权申请的审批人是企业管理员，还是 SEP 平台管理员；
5. 申请批准后，平台是否自动创建或分配新的 `subscriptionId`；
6. `/enterprise/skill-versions` 是否按照本文的幂等和原文保留规则实现；
7. 当前 `GET /enterprise/employees/:employeeId/skills` 对未授权员工返回 `403` 还是 `404`；
8. 平台目录中的能力摘要是否直接复用 `capability` 数据，还是单独维护员工能力标签。
