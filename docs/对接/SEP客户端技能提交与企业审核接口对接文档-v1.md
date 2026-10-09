# SEP 客户端技能提交与企业审核接口对接文档

> **历史文档，已被 v2 替代（2026-10-09）。** 新客户端对接请使用 [SEP客户端技能提交与企业审核接口对接文档-v2](SEP客户端技能提交与企业审核接口对接文档-v2.md)，业务规则以 [技能库技能审核统一优化方案-v1](../development/技能库技能审核统一优化方案-v1.md) 为准。本文“通过不发布企业版、不更新默认”“待审或已通过个人记录不可选用”等旧边界已被替代，不再作为当前契约。
>
> 本文生产来源校验、代理链路和请求诊断仅为 **2026-10-08 历史记录**；保留原文不表示本次重新验证了生产，更不表示 v2 对应的本地实现已经线上部署。

- **文档版本**：v1.0
- **更新时间**：2026-10-08
- **适用客户端**：SEP Electron／桌面客户端
- **适用服务**：SEP 技能库、个人 Skill 版本提交、企业审核
- **当前结论**：已核对当前后端代码及生产请求来源校验链路

> 本文用于客户端对接 `POST /api/enterprise/skill-versions` 个人 Skill 版本提交接口，以及企业管理员审核接口。
>
> 本轮**不修改 Web 审核页面**，也不关闭或放宽后端的 Origin／Referer 校验、JWT 认证和企业权限校验。

---

## 1. 结论先行

### 1.1 生产 API 地址

客户端统一使用：

```text
API_BASE_URL = https://longdaosep.cn/api
```

完整接口地址示例：

```text
https://longdaosep.cn/api/enterprise/skill-versions
```

不要把 `/api` 拼接两次，例如以下地址是错误的：

```text
https://longdaosep.cn/api/api/enterprise/skill-versions
```

### 1.2 生产请求来源校验配置

已核对生产环境：

```text
NODE_ENV=production
CORS_ORIGIN=https://longdaosep.cn
```

因此，桌面客户端调用普通企业写接口时必须带以下来源头：

```http
Origin: https://longdaosep.cn
Referer: https://longdaosep.cn/
```

其中任意一个正确来源头即可通过当前来源校验；建议客户端两个都发送，以兼容不同网络库和反向代理配置。

本次生产诊断结果：

| 请求条件 | 生产结果 | 说明 |
| --- | --- | --- |
| 不带 `Origin`／`Referer` | `403 Missing Origin or Referer header` | 被来源校验拦截，尚未进入 JWT 认证 |
| 带正确来源，但不带 Token | `401 Unauthorized` | 来源校验已通过，随后进入认证 |
| `Origin: https://longdaosep.cn` | `401 Unauthorized`（无 Token 时） | 允许来源 |
| `Referer: https://longdaosep.cn/` | `401 Unauthorized`（无 Token 时） | Referer 会被规范化为同一 Origin |
| 非法来源，例如 `https://client.invalid` | `403 ... CSRF protection.` | 被来源校验拦截 |

结论：本次客户端收到的 `403 Missing Origin or Referer header` 不是技能权限错误，也不是 Bearer Token 失效，而是客户端没有发送来源头，或来源头在请求链路中没有保留。

### 1.3 Bearer Token 与来源校验是两件事

- `Authorization: Bearer <accessToken>`：用于身份认证和企业权限判断。
- `Origin`／`Referer`：用于生产环境请求来源校验。
- 合法 Bearer Token **不能替代** `Origin`／`Referer`。
- 当前接口不额外要求 Web Cookie 或独立 CSRF Token；桌面客户端使用 access token 加允许来源头即可。
- 必须使用 access token，不能使用 refresh token。

已核对生产 Caddy／Next rewrite 链路没有删除 `Origin`、`Referer` 或 `Authorization` 请求头。

---

## 2. 所有请求的通用头

### 2.1 写请求

`POST`／`PUT`／`PATCH`／`DELETE` 请求建议统一发送：

```http
Authorization: Bearer <accessToken>
Origin: https://longdaosep.cn
Referer: https://longdaosep.cn/
Content-Type: application/json
```

### 2.2 读请求

`GET` 请求当前不经过写操作来源校验，但建议也发送 `Authorization`，并保留来源头，方便客户端统一封装和问题排查：

```http
Authorization: Bearer <accessToken>
Origin: https://longdaosep.cn
Referer: https://longdaosep.cn/
```

### 2.3 Electron／Node 网络库注意事项

部分 Electron／Node 请求库不会自动生成浏览器的 `Origin` 和 `Referer`。请在请求拦截器或 API Client 中显式设置，不要只依赖浏览器页面环境。

如果客户端底层网络库禁止设置这些请求头，应先与平台后端确认网络库方案；不要通过关闭来源校验来规避问题。

---

## 3. 个人 Skill 版本提交接口

### 3.1 接口定义

```http
POST /api/enterprise/skill-versions
```

完整地址：

```text
${API_BASE_URL}/enterprise/skill-versions
```

权限要求：

1. 当前用户必须是有效企业成员；
2. access token 有效；
3. 当前企业有处于 `ACTIVE` 且未过期的相关订阅；
4. 订阅绑定了目标 `SKILL` 能力；
5. 当前员工或所属部门对该能力有有效授权；
6. `parentVersionId` 必须是当前用户可见、且与 `capabilityId` 匹配的版本。

该接口**不是企业管理员专用接口**。普通员工可以提交自己的 Skill 修改，但仍必须满足上述技能订阅和授权条件。

### 3.2 请求头

除通用头外，必须增加幂等键：

```http
Authorization: Bearer <accessToken>
Origin: https://longdaosep.cn
Referer: https://longdaosep.cn/
Idempotency-Key: skill_save_20261008_00000001
Content-Type: application/json
```

`Idempotency-Key` 限制：

- 必填；
- 长度 16～128 个字符；
- 只允许字母、数字、下划线 `_` 和连字符 `-`；
- 每次新的保存操作使用新 Key；
- 网络失败、超时或响应丢失时，使用原 Key 重试。

### 3.3 请求体

```json
{
  "capabilityId": "capability-data-analysis",
  "parentVersionId": "platform-skill-version-data-analysis-v1",
  "content": "---\nname: data-analysis\ndescription: 数据分析\n---\n\n# 工作方法\n先确认数据范围，再进行分析。\n",
  "changeSummary": "补充数据范围确认步骤"
}
```

字段说明：

| 字段 | 类型 | 必填 | 限制 |
| --- | --- | --- | --- |
| `capabilityId` | string | 是 | 1～128 个字符 |
| `parentVersionId` | string | 是 | 1～128 个字符 |
| `content` | string | 是 | 1～500,000 个字符 |
| `changeSummary` | string | 否 | trim 后最多 2,000 个字符；未传时为 `null` |

请求体是严格结构校验，客户端不要额外传入以下字段：

```text
enterpriseId
userId
memberId
ownerId
scope
version
status
subscriptionId
```

企业、提交人、版本作用域、版本号、审核状态等字段全部由后端根据 access token 和企业上下文生成。

### 3.4 `content` 原样保存要求

客户端上传的是完整 Skill 正文，不是渲染后的 HTML，也不是提取后的 Markdown 片段。必须保留：

- YAML frontmatter；
- Markdown 正文；
- LF／CRLF 换行；
- Unicode 字符；
- 尾部空白；
- 原始正文顺序。

不要在上传前执行以下操作：

- `trim()`；
- 去除 frontmatter；
- Markdown 渲染后再反向生成正文；
- 自动替换换行符；
- 截断超长正文；
- 把正文放到 `contentHtml` 或其他字段。

### 3.5 `parentVersionId` 可选来源

当前提交接口允许以下来源：

| 来源 | 可用条件 |
| --- | --- |
| `PLATFORM` | 状态为 `PLATFORM_APPROVED` |
| `ENTERPRISE` | 当前企业的版本，状态为 `ENTERPRISE_APPROVED` |
| `PERSONAL` | 当前企业、且属于当前用户的个人版本 |

来源版本不存在或当前用户不可见时，服务端返回 `404`，不会泄露无权访问的版本信息。来源存在但能力与 `capabilityId` 不匹配时，返回 `400`。

### 3.6 成功响应

首次提交返回 HTTP `201`，并且**创建即进入企业审核队列**：

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
  "submittedAt": "2026-10-08T08:30:00.000Z",
  "enterpriseReviewedAt": null,
  "rejectionReason": null,
  "createdAt": "2026-10-08T08:30:00.000Z",
  "updatedAt": "2026-10-08T08:30:00.000Z",
  "content": "---\nname: data-analysis\ndescription: 数据分析\n---\n\n# 工作方法\n先确认数据范围，再进行分析。\n"
}
```

客户端应将 `id` 和 `version` 当作不透明字符串使用，不要依赖其内部格式或自行生成版本号。

这里的响应不是 `{ data: ... }` 包装，也不是 `{ version: ... }` 包装，而是直接返回版本对象。

### 3.7 幂等重试

幂等范围由“当前企业 + 当前用户 + `Idempotency-Key`”确定：

- 相同 Key、相同请求内容：返回同一个版本的当前状态，HTTP 仍为 `201`；
- 相同 Key、但请求内容不同：返回 `409`；
- 审核后用原 Key 重试：返回已有版本的最新审核状态，不会重新排队；
- 新的保存必须生成新的 Key；
- 只有网络失败或响应丢失的原请求重试才复用旧 Key。

客户端建议持久化“正在提交”的 Key，直到收到成功或明确失败结果，避免网络重试造成重复记录。

### 3.8 提交失败处理

| HTTP | 常见原因 | 客户端处理 |
| --- | --- | --- |
| `400` | 请求字段、`Idempotency-Key`、来源版本能力不匹配 | 修正请求后再提交；不要盲目重试 |
| `401` | access token 缺失、过期或无效 | 走既有 refresh 流程，刷新成功后重试原请求 |
| `403` | 当前用户不属于企业，或来源校验失败 | 区分 `Missing Origin or Referer` 与权限错误；先检查来源头 |
| `404` | 技能无有效授权，或来源版本不可见 | 刷新技能与授权信息，不要通过传入 enterpriseId 绕过 |
| `409` | 同一个 Key 对应了不同内容，或审核重复处理 | 原 Key 不可用于新内容；新保存生成新 Key |

---

## 4. 查询个人提交、预览和审核队列

### 4.1 查询当前技能的可见版本

```http
GET /api/enterprise/skill-versions?capabilityId=<capabilityId>
```

可选状态过滤：

```http
GET /api/enterprise/skill-versions?capabilityId=<capabilityId>&status=PENDING_ENTERPRISE_REVIEW
```

当提供 `capabilityId` 时，返回：

- 已通过的平台版本；
- 当前企业已通过的企业版本；
- 当前用户自己的个人版本，包括待审、已通过、已驳回状态。

个人记录查询**必须带 `capabilityId`**。如果省略该参数，会进入旧的企业版本列表契约，不保证返回个人送审记录。

列表返回版本摘要，不包含正文。正文使用下面的 preview 接口读取。

### 4.2 预览版本正文

```http
GET /api/enterprise/skill-versions/:versionId/preview
```

返回版本摘要、能力摘要和 Markdown `content`。客户端展示正文时应限制危险 HTML、脚本和不可信外链，不要把待审核正文直接注入运行时执行环境。

权限边界：

- 普通员工：只能预览自己有授权、且允许访问的版本；
- 企业管理员：可以预览本企业已进入审核流程的个人送审正文；
- 其他企业或无权用户：返回 `404` 或权限错误。

### 4.3 企业管理员查询审核队列

```http
GET /api/enterprise/skill-version-reviews
```

支持查询参数：

```text
status=PENDING_ENTERPRISE_REVIEW
capabilityId=<可选>
page=1
limit=20
```

其中：

- `status` 可选值：`PENDING_ENTERPRISE_REVIEW`、`ENTERPRISE_APPROVED`、`ENTERPRISE_REJECTED`；
- 不传 `status` 时默认查询 `PENDING_ENTERPRISE_REVIEW`；
- `page` 默认 `1`；
- `limit` 默认 `20`，最大 `100`；
- 仅企业管理员可调用；
- 只返回当前企业的个人送审版本；
- 列表不包含 `content`，正文另调 preview。

成功响应：

```json
{
  "total": 1,
  "items": [
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
      "submittedAt": "2026-10-08T08:30:00.000Z",
      "enterpriseReviewedAt": null,
      "rejectionReason": null,
      "createdAt": "2026-10-08T08:30:00.000Z",
      "updatedAt": "2026-10-08T08:30:00.000Z"
    }
  ],
  "page": 1,
  "limit": 20
}
```

---

## 5. 企业管理员审核接口

### 5.1 接口定义

```http
POST /api/enterprise/skill-versions/:versionId/review
```

仅 `ENTERPRISE_ADMIN` 可以审核。平台 `ADMIN` 不会自动替代企业管理员身份，部门负责人也不能调用该接口。

### 5.2 审核通过

```http
POST /api/enterprise/skill-versions/psv_4f7d.../review
Authorization: Bearer <enterpriseAdminAccessToken>
Origin: https://longdaosep.cn
Referer: https://longdaosep.cn/
Content-Type: application/json

{
  "decision": "APPROVE",
  "comment": "审核通过"
}
```

审核通过后：

```text
status = ENTERPRISE_APPROVED
enterpriseReviewedAt = <审核时间>
rejectionReason = null
```

### 5.3 审核驳回

```http
POST /api/enterprise/skill-versions/psv_4f7d.../review
Authorization: Bearer <enterpriseAdminAccessToken>
Origin: https://longdaosep.cn
Referer: https://longdaosep.cn/
Content-Type: application/json

{
  "decision": "REJECT",
  "comment": "请补充异常处理说明"
}
```

驳回后：

```text
status = ENTERPRISE_REJECTED
enterpriseReviewedAt = <审核时间>
rejectionReason = 请补充异常处理说明
```

规则：

- `decision` 只能是 `APPROVE` 或 `REJECT`；
- `REJECT` 时 `comment` 必填，trim 后不能为空，最多 2,000 个字符；
- 审核正文不会被修改；
- 同一版本不能重复审核；
- 只能审核当前企业的个人送审版本；
- 审核动作会写入审核历史。

### 5.4 审核成功不等于全企业默认版本切换

个人提交审核通过只表示：

```text
当前个人 Skill 版本获得企业审核认可
```

它不会自动：

- 替换全企业默认版本；
- 影响其他成员；
- 修改企业订阅默认 Skill 版本；
- 自动进入运行时执行。

---

## 6. 当前版本选择能力的边界（客户端必须注意）

当前工作区的版本选择／执行实现中，个人选择接口可直接生效的个人版本状态是：

```text
scope = PERSONAL
status = PERSONAL_ACTIVE
ownerId = 当前用户
enterpriseId = 当前企业
```

而个人送审接口审核通过后生成的是：

```text
scope = PERSONAL
status = ENTERPRISE_APPROVED
```

因此，以当前实现为准：

- `PERSONAL + ENTERPRISE_APPROVED` 可以被本人查询；
- 可以被本人或企业管理员预览；
- **不能承诺它已经可以通过个人选版接口选择并进入运行时执行**；
- 不应在客户端把它显示为“已生效”或“当前正在使用”；
- 它也不能直接套用只接受 `PERSONAL_ACTIVE` 的企业采纳接口。

客户端界面应区分以下概念：

| 概念 | 含义 |
| --- | --- |
| 企业默认版本 | 企业订阅当前默认使用的版本 |
| 个人送审版本 | 当前用户提交、等待企业审核的版本 |
| 企业审核通过 | 企业认可该个人提交，但不代表已经生效 |
| 个人当前选用版本 | 当前用户明确选择且执行链支持的版本 |
| `PERSONAL_ACTIVE` | 当前实现可用于个人选版／执行的个人活跃副本 |

如后续平台后端将 `PERSONAL + ENTERPRISE_APPROVED` 接入个人选版／执行链，需要另行更新接口契约和客户端状态映射；在此之前不要根据 `ENTERPRISE_APPROVED` 自动切换运行时版本。

---

## 7. 与其他技能版本接口的区别

### 7.1 本文主接口：个人完整正文送企业审核

```http
POST /api/enterprise/skill-versions
```

特点：

- 保存完整个人 Skill 原文；
- 创建即送审；
- 创建状态为 `PENDING_ENTERPRISE_REVIEW`；
- 必须使用 `Idempotency-Key`；
- 面向客户端个人修改提交。

### 7.2 企业私有版本草稿接口

```http
POST /api/enterprise/subscriptions/:subscriptionId/skill-versions
```

该接口用于企业版本草稿流程，不是个人客户端送审接口。不要把它与本文主接口混用，也不要把主接口创建后的版本再调用一次“submit”。

### 7.3 旧个人活跃副本接口

旧的个人版本路径会生成或编辑 `PERSONAL_ACTIVE` 副本，属于直接可用的个人副本流程，不等同于本文的“个人修改送企业审核”流程。

本文主接口没有单独的撤回路由。不要把以下接口当作送审记录撤回接口：

```http
DELETE /api/enterprise/personal-versions/:id
PATCH /api/enterprise/personal-versions/:id
```

如果送审版本被驳回，需要使用新 `Idempotency-Key` 创建新的送审记录；旧 Key 只会返回旧记录的当前状态。

---

## 8. 客户端实现示例

### 8.1 Electron `fetch`

```ts
const API_BASE_URL = 'https://longdaosep.cn/api';

async function submitSkillVersion(
  accessToken: string,
  request: {
    capabilityId: string;
    parentVersionId: string;
    content: string;
    changeSummary?: string;
  },
  idempotencyKey: string,
) {
  const response = await fetch(`${API_BASE_URL}/enterprise/skill-versions`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      Origin: 'https://longdaosep.cn',
      Referer: 'https://longdaosep.cn/',
      'Idempotency-Key': idempotencyKey,
      'Content-Type': 'application/json',
    },
    // 不要对 request.content 做 trim 或 Markdown 重渲染。
    body: JSON.stringify(request),
  });

  const body = await response.json().catch(() => null);
  if (!response.ok) {
    throw new Error(`${response.status}: ${body?.message ?? '技能提交失败'}`);
  }
  return body;
}
```

### 8.2 重试示例

```text
第一次请求：Idempotency-Key = skill_save_20261008_00000001
网络超时：使用同一个 Key 重试
用户编辑了新内容：生成新的 Key，例如 skill_save_20261008_00000002
```

---

## 9. 联调验收清单

### 9.1 来源和认证

- [ ] API Base 为 `https://longdaosep.cn/api`；
- [ ] 最终请求没有重复 `/api`；
- [ ] 写请求带 `Origin: https://longdaosep.cn`；
- [ ] 写请求带 `Referer: https://longdaosep.cn/`；
- [ ] 使用 access token，而不是 refresh token；
- [ ] `Authorization`、`Origin`、`Referer` 没有被客户端拦截器或代理删除；
- [ ] 无来源头时能识别 `403 Missing Origin or Referer header`；
- [ ] 带正确来源但不带 Token 时得到 `401`，而不是 `403`。

### 9.2 提交契约

- [ ] 请求体只发送 `capabilityId`、`parentVersionId`、`content`、`changeSummary`；
- [ ] 每次新保存使用新的 `Idempotency-Key`；
- [ ] 网络重试复用原 Key；
- [ ] Skill 正文保留 frontmatter 和原始换行；
- [ ] 首次成功响应为 `201`；
- [ ] 首次状态为 `PENDING_ENTERPRISE_REVIEW`；
- [ ] 客户端不会再额外调用一个不存在的个人送审 submit 接口。

### 9.3 审核和状态

- [ ] 查询个人版本时带 `capabilityId`；
- [ ] 审核队列仅企业管理员调用；
- [ ] 驳回时发送非空 `comment`；
- [ ] `ENTERPRISE_APPROVED` 被展示为“企业审核通过”，而不是直接展示为“个人当前生效”；
- [ ] 客户端没有在审核通过后自动切换运行时版本；
- [ ] `content` 预览与执行环境隔离。

---

## 10. 平台确认项与本轮范围

平台后端确认结果：

1. 生产允许来源为 `https://longdaosep.cn`；
2. `https://longdaosep.cn/` 的 Referer 会被规范化并允许；
3. 正确来源头能通过来源校验，随后才进行 JWT 认证；
4. Caddy／Next rewrite 未丢失 `Origin`、`Referer`、`Authorization`；
5. Electron 客户端可以使用 Bearer Token 对接，不额外要求 Web Cookie 或 CSRF Token；
6. 首次成功提交直接进入 `PENDING_ENTERPRISE_REVIEW`；
7. 不需要修改 Web 审核页面来解决本次 `403`；
8. 不应通过关闭来源校验或权限检查来解决客户端问题。

本轮未做以下变更：

- 未修改 Web 审核页面；
- 未修改 CSRF Guard；
- 未修改生产 `CORS_ORIGIN`；
- 未放宽接口权限；
- 未使用生产凭据执行真实带 Token 的技能上传。

生产诊断请求只验证了来源门禁、认证前后状态和路由转发链路，不代表已经替客户端完成真实业务提交。
