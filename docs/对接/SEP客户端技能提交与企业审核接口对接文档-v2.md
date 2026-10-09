# SEP 客户端技能提交与企业审核接口对接文档 v2

- 文档版本：v2.0，2026-10-09。
- 适用入口：SEP Electron／桌面客户端与 Web 技能库。
- 依据：[技能库技能审核统一优化方案-v1](../development/技能库技能审核统一优化方案-v1.md) 及当前工作区后端 controller、service、共享 Zod DTO。
- 状态：**按本地已开发代码描述接口，不声明线上已部署，不声明生产重新验证或客户端仓库已经完成接入。** 目标环境是否部署了兼容代码及迁移，须由发布负责人确认并另行联调。
- 替代：[旧客户端对接 v1](SEP客户端技能提交与企业审核接口对接文档-v1.md) 中的旧审核／选版边界。旧文档 2026-10-08 的生产来源诊断仅作历史参考。

本文不修改认证协议、来源校验或执行授权。所有 ID、时间和请求体示例均为虚构；所有 token 均为占位符。

## 1. 客户端必须采用的新语义

1. 保存个人修改即可本人选用，无须先通过企业审核。客户端提交产生不可变个人记录，Web 可编辑工作副本保持 `PERSONAL_ACTIVE`；管理员个人保存也不自动发布企业版。
2. 客户端“审核”和 Web 原“采纳”是同一企业审核机制，入口融入对应技能的技能库详情，不建立第二套独立审核业务或要求到旧审核中心处理。
3. 审核通过保留原 `PERSONAL` 记录及 ID，另外创建 `ENTERPRISE / ENTERPRISE_APPROVED` 版本，用 `publishedVersionId` 返回发布关联，同时更新“本企业 + 此技能”的全局默认。
4. 驳回不创建企业版、不修改企业默认；本人个人内容仍可选择使用。其他成员不能选择该私有个人记录，应选择发布后的企业版。
5. “我使用此版本”（PIN）、“跟随企业”（FOLLOW）和“设为企业默认”是独立动作。审核或切换企业默认不覆盖任何成员显式 PIN，也不删除历史版本。
6. 看得到企业历史版不等于有权执行或编辑。执行／个人选版仍要求有效订阅、技能绑定和本人或部门授权；企业审核与默认管理要求本企业 `ENTERPRISE_ADMIN`，不要求管理员本人有该技能的执行授权。

```text
客户端保存完整 SKILL.md → PERSONAL / PENDING_ENTERPRISE_REVIEW → 本人可主动 PIN 自用
Web 保存工作副本        → PERSONAL / PERSONAL_ACTIVE         → 同一技能的个人改动
                                   ↓ 本企业管理员审核
通过 → 固定审核内容 + 审核记录 + 新 ENTERPRISE 版本 + 更新企业全局默认
驳回 → 留存快照与原因，个人内容仍可自用，不动企业默认
                                   ↓ 两端刷新
原个人 ID 查询结果；publishedVersionId 定位企业版；FOLLOW 跟随默认，PIN 保持选择
```

客户端保存并不自动替用户 PIN；如提供“保存并使用”操作，应在收到保存回执后单独调用本人选版接口。不得把 `201`、`ENTERPRISE_APPROVED` 或列表排序当作“本人正在使用”的证明。

## 2. 地址、来源和认证保持不变

### 2.1 地址与请求头

配置按目标环境提供，`API_BASE_URL` 已包含 `/api`，不得再次拼接 `/api`。沿用地址示例：

```text
API_BASE_URL = https://longdaosep.cn/api
提交 URL = ${API_BASE_URL}/enterprise/skill-versions
```

此地址仅为客户端配置示例，不是本次生产可用性或 v2 部署验证结果。写请求继续携带：

```http
Authorization: Bearer <accessToken>
Origin: https://longdaosep.cn
Referer: https://longdaosep.cn/
Content-Type: application/json
```

- 使用 access token，不使用 refresh token。认证恢复沿用已有客户端流程，本文不另建登录或 refresh 协议。
- Bearer 用于身份与权限，Origin／Referer 用于来源校验，两者不能互相替代。企业技能写接口没有获得原生客户端来源豁免。
- 当前来源 guard 按目标环境 `CORS_ORIGIN` 校验；生产模式缺失来源头返回 `403 Missing Origin or Referer header`。Origin 优先于 Referer，非法 Origin 不会因合法 Referer 被放行；两个头应匹配允许来源。
- Electron／Node 请求库须显式保留这些头；不要通过关闭来源校验、放宽企业权限或伪造企业字段解决问题。
- GET 可保留相同来源头，仍需 Bearer。本文企业接口不额外要求独立 CSRF token，不能因此省略来源头。

### 2.2 提交幂等头

仅完整正文提交接口强制要求：

```http
Idempotency-Key: skill_save_20261009_example_0001
```

长度 16～128，只允许字母、数字、`_`、`-`。每次新保存生成新键；同一次保存网络超时、响应丢失或认证恢复后重试，复用原键与原请求体。审核和选版接口未实现基于此头的幂等回执，不能套用提交接口的重试语义。

## 3. 接口速查

下表路径均相对于 `API_BASE_URL`；未特别标注的查询成功为 `200`、POST 成功为 `201`。

| 方法与路径 | 用途／返回重点 |
| --- | --- |
| `POST /enterprise/skill-versions` | 完整正文个人保存及送审；版本对象含 `publishedVersionId` |
| `GET /enterprise/skill-versions?capabilityId=...` | 已发布平台／本企业版本、本人个人记录；直接返回摘要数组 |
| `GET /enterprise/skill-versions/:id/preview` | 按企业／版本可见性读取正文与 `updatedAt`；本企业已发布企业版不要求执行 grant |
| `GET /enterprise/capabilities` | 技能库列表、企业默认摘要、统一待办统计 |
| `GET /enterprise/capabilities/:capabilityId/personal-diffs` | 技能详情个人改动／大家的改动，含正文、基线及分页 |
| `GET /enterprise/skill-version-reviews` | 管理员兼容审核队列，保留 `status/capabilityId/page/limit` |
| `POST /enterprise/skill-versions/:id/review` | 单条统一审核，通过后发布并改默认 |
| `POST /enterprise/capabilities/:capabilityId/adopt` | 旧 Web 审核通过兼容入口；多源必须确认最终合并正文，推荐单条审核 |
| `GET /enterprise/capabilities/:capabilityId/versions` | 时间线、企业默认与逐订阅本人选择／实际生效信息 |
| `GET /enterprise/employees/:employeeId/skills` | 已授权数字员工技能；`enterpriseVersion` 与 `currentVersion` 分开 |
| `POST /enterprise/subscriptions/:subscriptionId/skills/:capabilityId/select-personal-version` | 本人 PIN／FOLLOW，不改企业默认 |
| `POST /enterprise/capabilities/:capabilityId/default-version` | 新企业全局默认接口，管理员操作 |
| `POST /enterprise/subscriptions/:subscriptionId/skills/:capabilityId/select-version` | 旧默认接口兼容，但语义已是全企业，不是单订阅 |

Web 工作副本仍使用 `POST /enterprise/capabilities/:capabilityId/personal-version` 创建，以及 `PATCH /enterprise/personal-versions/:id` 保存正文。PATCH 成功为 `200`，只编辑本人合法工作副本，不能修改客户端送审快照或已发布历史企业版。不要为了统一审核把所有客户端记录改为 Web 工作副本。

## 4. 完整个人正文保存与幂等回执

### 4.1 请求

```http
POST /api/enterprise/skill-versions
Authorization: Bearer <accessToken>
Origin: https://longdaosep.cn
Referer: https://longdaosep.cn/
Idempotency-Key: skill_save_20261009_example_0001
Content-Type: application/json
```

```json
{
  "capabilityId": "example-capability",
  "parentVersionId": "example-platform-version",
  "content": "---\nname: example-skill\ndescription: 示例技能\n---\n\n# 工作方法\n先确认数据范围，再进行分析。\n",
  "changeSummary": "补充数据范围确认步骤"
}
```

| 字段 | 校验 |
| --- | --- |
| `capabilityId`、`parentVersionId` | 必填字符串，各 1～128 个字符 |
| `content` | 必填字符串，1～500,000 个字符；不是按 UTF-8 字节数校验 |
| `changeSummary` | 可选字符串，trim 后最多 2,000 个字符；省略时保存为 `null` |

提交 DTO 为严格对象，不发送 `enterpriseId/userId/memberId/ownerId/scope/status/version/subscriptionId` 等额外字段；身份、企业、状态、版本号由服务端确定。完整 `SKILL.md` 包括 frontmatter、Unicode、LF／CRLF 和尾部空白，`content` 不做 trim、换行转换、渲染后重建或截断。

客户端 submit 始终保存单条不可变个人记录，不是多源合并接口；不需要、也不要传入 `expectedUpdatedAt` 或 `expectedMergedContent`。当前保存及幂等重试回执中的 `publishedVersionId` 已在本地实现，用于返回原记录现有发布关联，不是待实现字段。

要求当前企业有 ACTIVE 且未过期的订阅、启用的 SKILL 绑定和本人／部门有效授权。来源可为已通过平台版、当前企业已通过企业版，或当前企业本人的个人版本；不可见／不存在返回 `404`，能力不匹配返回 `400`。

### 4.2 首次保存回执示例

直接返回对象，不包在 `data` 或 `version` 中。以下为字段示例，ID 不代表真实记录：

```json
{
  "id": "example-personal-submission",
  "capabilityId": "example-capability",
  "parentVersionId": "example-platform-version",
  "enterpriseId": "example-enterprise",
  "ownerId": "example-owner",
  "scope": "PERSONAL",
  "version": "example-personal-version-label",
  "status": "PENDING_ENTERPRISE_REVIEW",
  "changeSummary": "补充数据范围确认步骤",
  "submittedAt": "2026-10-09T02:00:00.000Z",
  "enterpriseReviewedAt": null,
  "rejectionReason": null,
  "createdAt": "2026-10-09T02:00:00.000Z",
  "updatedAt": "2026-10-09T02:00:00.000Z",
  "content": "---\nname: example-skill\ndescription: 示例技能\n---\n\n# 工作方法\n先确认数据范围，再进行分析。\n",
  "publishedVersionId": null
}
```

保存 `id` 作为原个人回执 ID，版本标签与 ID 均视为不透明字符串。`201` 表示已持久化，不表示企业已通过；首次待审记录已经可由本人通过独立选版接口 PIN 自用。

### 4.3 重试不会重新排队或重新发布

幂等范围为“当前企业 + 当前用户 + Key”，匹配字段为 `capabilityId/parentVersionId/content/changeSummary`（说明按 DTO trim 后比较）。

| 情况 | 结果 |
| --- | --- |
| 原 Key + 相同请求体 | `201`，同一 ID 的当前状态，不新建记录 |
| 原记录已通过且发布 | 原 ID、`scope=PERSONAL`、当前 `status=ENTERPRISE_APPROVED`、已有 `publishedVersionId` |
| 原记录已驳回 | 原 ID、`ENTERPRISE_REJECTED` 与原因，发布关联为空 |
| 原 Key + 不同保存内容 | `409`，不覆盖原内容；真正的新保存使用新 Key |

重试仍重新校验当前企业与技能授权，不保证授权撤销后仍能拿到回执。不要通过重试提交重置审核状态、切换企业默认或再发企业版。新的修订使用新 Key，并保留此前个人记录及审核历史。

## 5. 查询、统一状态与兼容队列

### 5.1 原个人记录与企业发布关联

```http
GET /api/enterprise/skill-versions?capabilityId=example-capability
GET /api/enterprise/skill-versions/example-personal-submission/preview
GET /api/enterprise/skill-versions/example-enterprise-version/preview
```

第一个接口返回摘要数组，含 `publishedVersionId`，不含正文。要查询本人回执必须带 `capabilityId`，否则进入旧企业版本列表契约。可选 `status` 是底层记录状态过滤，**不是**工作副本的归一化审核状态过滤。

查询原个人 ID 的审核结果后，用 `publishedVersionId` 找到新企业版；原个人 ID 不变，也不变为 ENTERPRISE。预览返回正文和摘要，但目前不返回归一化 `reviewStatus/publishedVersionId`，不能只轮询 preview 跟踪发布关联。

本企业已发布 `ENTERPRISE` 版本的 preview 按企业可见性校验，不要求成员本人有执行 grant；管理员还可预览本企业未发布企业版及审核内容。普通成员只看自己的私有改动，不能借 preview 查看他人的个人正文或跨企业版本。当前源码中 PLATFORM 和普通成员本人的 PERSONAL 正文仍校验技能 grant，不应将企业版的免执行授权读取规则扩大到所有作用域。

正文可见不等于获得编辑、个人选版或执行权限，这些写操作／执行仍校验使用授权。展示 Markdown 时限制脚本、危险 HTML 与不可信外链。

### 5.2 技能详情“个人改动／大家的改动”

```http
GET /api/enterprise/capabilities/example-capability/personal-diffs?page=1&limit=20&status=PENDING_ENTERPRISE_REVIEW
```

`status` 不传表示全部审核状态；支持待审、已通过、已驳回三个值，`page >= 1`，`1 <= limit <= 100`，默认 `1/20`。管理员看本企业全部根个人记录，普通成员仅看自己；内部审核快照不作为第二条改动重复展示。

返回 `{ canManage, baseline, myWorkingCopy, total, page, limit, items }`。`baseline` 含企业当前默认（无默认时兼容回落）的正文；`items` 含 `id/owner/basedOn/content/changeSummary/updatedAt/status/submittedAt`，并含：

| 字段 | 客户端含义 |
| --- | --- |
| `reviewStatus` | 本次个人内容的归一化审核状态，用于标签和审核状态筛选 |
| `publishedVersionId` | 本次审核生成的企业版 ID；未发布为 `null` |
| `isWorkingCopy` | 是否可编辑工作副本；工作副本底层 `status` 保持 `PERSONAL_ACTIVE` |
| `isLegacyUnpublished` | 历史已通过但无企业发布关联，不等于新闭环已完成 |
| `pending` | 待处理标志，也包括历史已通过未发布的兼容处理 |
| `enterpriseReviewedAt`、`rejectionReason` | 对当前修订的审核时间／驳回原因 |
| `reviewedBy` | 衍生审核人，类型 `{ id: string; name: string \| null } \| null`；对应当前修订的审核快照或提交记录，不是内容作者 |
| `canEdit` | 本人可编辑的工作副本；送审记录不可在此直接改写 |
| `adopted`、`adoptedAt` | 保留旧字段名以兼容，界面文案使用“审核／已发布” |

`reviewedBy` 与 `reviewStatus` 等字段由 `personalReviewState` 统一派生；工作副本当前修订已审时取对应审核快照的审核人，非工作副本取提交记录的审核人。对象中的 `name` 可以为 `null`，历史记录也可能没有审核人关联；字段为 `null` 或旧响应缺失时显示“审核人信息不可用”，不冒用 `owner`，也不能仅凭审核人为空推断未审核，状态以 `reviewStatus` 为准。

工作副本审核后创建不可变 PERSONAL 快照，原工作副本仍能继续保存；没有新修改时显示已审结果，后续保存使当前修订重新成为待审。并发保存时服务端会排除正文与修订时间不一致的项目，单页 `items` 可能短于 `limit`；不要据此宣布所有待办已消失，应按 `total` 与分页重拉。

### 5.3 旧队列保留分页与状态协议

```http
GET /api/enterprise/skill-version-reviews?capabilityId=example-capability&status=PENDING_ENTERPRISE_REVIEW&page=1&limit=20
```

仅本企业管理员可查询。`status` 默认 `PENDING_ENTERPRISE_REVIEW`，另外支持 `ENTERPRISE_APPROVED/ENTERPRISE_REJECTED`；`page` 默认 1，`limit` 默认 20、最大 100。返回包装仍为 `{ total, items, page, limit }`，不含正文；正文另调 preview。

此队列现在包含 Web 工作副本与客户端提交。`status` 参数按 `reviewStatus` 筛选，不能在客户端再次用 `item.status === query.status` 过滤，否则会漏掉 `PERSONAL_ACTIVE` 工作副本。例如下方是合法的“待审”队列条目（节选）：

```json
{
  "total": 1,
  "page": 1,
  "limit": 20,
  "items": [{
    "id": "example-web-working-copy",
    "scope": "PERSONAL",
    "status": "PERSONAL_ACTIVE",
    "reviewStatus": "PENDING_ENTERPRISE_REVIEW",
    "reviewedBy": null,
    "publishedVersionId": null,
    "isWorkingCopy": true,
    "isLegacyUnpublished": false,
    "pending": true,
    "updatedAt": "2026-10-09T02:10:00.000Z"
  }]
}
```

条目还保留原提交／审核时间、原因及归属字段，并包含 `capability`、`owner` 摘要，以及与 personal-diffs 相同的衍生 `reviewedBy: { id: string; name: string | null } | null`。新增关联／状态字段应允许兼容旧响应中缺失的情况；缺失时显示“关联待确认”，不得猜测已发布。审核人字段按第 5.2 节处理可空与历史兼容，不能把作者当作审核人。缺少字段也不是生产已支持 v2 的证明。

历史 `ENTERPRISE_APPROVED` 且无关联的记录显示“历史已通过、未发布企业版”：队列按已通过筛选，但 `pending=true`。它可能计入技能库待办，不能只查看默认待审队列判断全部待办。管理员确认后显式 APPROVE 发布；客户端不得自动补发或把旧决定扩大成企业默认。

技能库列表仍保留 `pendingAdoptionCount`、`summary.pendingAdoptionTotal` 等兼容字段名，含义是统一待处理改动统计；界面使用“待审核”，不再另建“待采纳”队列。

## 6. 企业统一审核与 409 重拉

### 6.1 单条审核

```http
POST /api/enterprise/skill-versions/example-web-working-copy/review
```

通过请求：

```json
{
  "decision": "APPROVE",
  "comment": "已核对正文与差异",
  "expectedUpdatedAt": "2026-10-09T02:10:00.000Z"
}
```

驳回请求：

```json
{
  "decision": "REJECT",
  "comment": "请补充异常处理说明",
  "expectedUpdatedAt": "2026-10-09T02:10:00.000Z"
}
```

- `decision` 仅 `APPROVE/REJECT`；`comment` trim 后最多 2,000 字符，REJECT 时必须非空。
- DTO 中 `expectedUpdatedAt` 为可选 ISO 8601 时间（支持时区偏移），但审核 Web `PERSONAL_ACTIVE` 工作副本时业务上必填，且须匹配管理员实际预览正文的修订时间。缺失或过期返回 `409`。
- 使用 preview 返回的 `updatedAt`，或 personal-diffs 同条正文配对的 `updatedAt`；不能用本机当前时间、别的记录时间或未展示正文的最新时间替换。
- 客户端不可变提交不强制 `expectedUpdatedAt`，旧客户端请求仍兼容；若审核的是 Web 副本，则无论操作来自哪一端都必须提交该字段。
- 审核权限只属于本企业管理员；提交／审核人／企业不能由请求体指定。

通过 `201` 响应节选：

```json
{
  "id": "example-personal-submission",
  "capabilityId": "example-capability",
  "scope": "PERSONAL",
  "status": "ENTERPRISE_APPROVED",
  "enterpriseReviewedAt": "2026-10-09T02:20:00.000Z",
  "rejectionReason": null,
  "publishedVersionId": "example-enterprise-version",
  "affectedSubscriptions": 2
}
```

一次通过在事务内写审核状态／快照、审核记录、新企业版、来源关联、企业默认及所有相关有效订阅默认；`affectedSubscriptions` 是相关订阅数，不是被强制换版本的人数。历史企业版与成员显式选择均保留，后续新增相关订阅也从企业级默认解析，不以“最新创建版本”推断默认。

客户端提交更新原 PERSONAL 记录状态；Web 工作副本则创建审核快照并返回原工作副本 ID 的本次审核结果。后者响应 `status` 表示本次结果，不能据此把原可编辑工作副本永久改为已审状态；成功后重拉 `personal-diffs` 的归一化结果。

驳回响应 `publishedVersionId=null`、`affectedSubscriptions=0`，保留原因，不改企业默认。客户端修改后以新 Key 保存；Web 本人继续修改副本后重新进入待审。

### 6.2 旧 Web 通过入口与受限批量兼容

当前 Web 技能详情没有一键批量审核入口，推荐逐条预览、逐条审核。保留以下接口仅用于兼容，不代表可以自动合并未经管理员确认的内容并发布。

```http
POST /api/enterprise/capabilities/example-capability/adopt
```

```json
{
  "sourceVersionIds": ["example-web-working-copy"],
  "changeSummary": "审核通过",
  "expectedUpdatedAt": "2026-10-09T02:10:00.000Z"
}
```

单条可用 `expectedUpdatedAt`，多源传 `expectedVersions: { "<来源ID>": "<对应预览updatedAt>" }`；两者同时存在时 `expectedVersions` 优先。来源数量 1～50、不重复、同企业同技能；所有 Web 副本须有各自预览依据。不可变客户端来源不强制修订时间。

Adopt DTO 新增 `expectedMergedContent?: string`，校验为 1～500,000 个字符，不做 trim。DTO 可选是为了兼容单条调用；当 `sourceVersionIds.length > 1` 时，统一服务 `reviewMany` **业务上必须收到管理员已经展示、核对并确认的完整最终合并正文**：

- 多源缺少 `expectedMergedContent` 返回 `409`，不得只传多个来源 ID 就发布。
- 服务端重新计算合并结果；只要存在合并冲突，即返回 `409`，即使调用方提交了正文也不能绕过冲突。
- 无冲突时，服务端合并正文必须与 `expectedMergedContent` 完全一致，否则返回 `409`；换行、空白和完整正文均参与字符串比较，不是只比摘要或版本号。
- 上述失败均不写审核结果／快照、来源发布关联或新企业版，也不更新企业默认。通过后才按统一事务发布，不是逐条静默覆盖默认。

兼容多源请求示例（正文仅演示字段；实际须为管理员确认且与服务端无冲突合并结果完全一致的内容）：

```json
{
  "sourceVersionIds": ["example-web-working-copy-a", "example-web-working-copy-b"],
  "changeSummary": "已确认最终合并正文",
  "expectedVersions": {
    "example-web-working-copy-a": "2026-10-09T02:10:00.000Z",
    "example-web-working-copy-b": "2026-10-09T02:12:00.000Z"
  },
  "expectedMergedContent": "---\nname: example-skill\ndescription: 示例技能\n---\n\n# 工作方法\n先确认数据范围，再进行分析。\n补充异常处理与结果复核。\n"
}
```

多源最终正文确认不能被各来源的 `expectedVersions` 替代；两类依据分别保护来源修订与最终发布内容。调用方如果没有完整最终正文预览与管理员确认流程，就使用单条审核，不新增自动批量发布行为。成功仍返回 `version/sources/affectedSubscriptions/batchId/adoptedCount/conflicts`，发布 ID 取 `version.id`。

### 6.3 重复处理／过期预览

审核重复点击、其他管理员已处理、Web 副本预览后被修改、多源缺少已确认最终正文、最终正文与服务端结果不一致，或合并冲突都可能返回 `409`。审核没有“同键重试返回成功”的提交幂等语义。

1. 停止自动重复审核，失效该技能的改动、队列、时间线、默认与本人状态缓存。
2. 重拉当前审核状态、发布关联和正文；已发布则展示当前结果，不再发布一次。
3. 若仍待审但内容已变，重新展示差异与正文，请管理员重新确认，再用新预览的 `updatedAt` 提交。
4. 多源缺少确认／正文不一致时改为逐条审核，或重新预览最终正文并由管理员确认后再提交；不能自动取新合并结果替换字段后重试。合并冲突改为逐条审核或解决冲突后重新保存／提交，不伪造成功、不自动发布冲突内容。

审核响应丢失时也先查询；若重试收到 `409`，按以上步骤恢复已完成结果，不把冲突当作上传失败。

## 7. 本人 PIN／FOLLOW 与企业全局默认

### 7.1 本人选择独立保存

```http
POST /api/enterprise/subscriptions/example-subscription/skills/example-capability/select-personal-version
```

固定本人个人版或已发布历史企业版：

```json
{ "versionId": "example-personal-submission" }
```

恢复显式跟随企业：

```json
{ "versionId": null }
```

必须发送 `versionId`，省略不等于 FOLLOW。接口仅写当前成员 + 当前订阅 + 技能的偏好，不写企业默认，也不代表跨所有订阅统一个人选择；应按客户端当前操作的订阅调用。`201` 返回选择记录，含 `memberId/subscriptionId/capabilityId/versionId` 等字段。

可 PIN：`PLATFORM / PLATFORM_APPROVED`、本企业 `ENTERPRISE / ENTERPRISE_APPROVED`、本企业本人的 PERSONAL 且状态为 `PERSONAL_ACTIVE/PENDING_ENTERPRISE_REVIEW/ENTERPRISE_APPROVED/ENTERPRISE_REJECTED`。归档个人版不可选；管理员也不能 PIN 他人私有个人版。

界面可以称 PIN／FOLLOW，但请求不发送模式字段；时间线实际返回的枚举是：

| `personalSelectionMode` | 含义 |
| --- | --- |
| `PINNED` | 非空 `versionId` 的显式选择；企业默认发布或回退不覆盖 |
| `FOLLOW_ENTERPRISE` | 已有选择记录且 `versionId=null`；跳过个人副本，跟随企业当前默认 |
| `AUTO` | 没有显式选择记录；兼容存量个人活跃副本优先，否则回落企业默认 |

AUTO 不应伪装成显式 FOLLOW。保存正文、刷新列表、看到新发布版都不能擅自调用选版接口。已有明确 PIN 保持所选历史内容，除非本人主动切换；若 PIN 的是可编辑工作副本，本人后续保存会更新该副本正文，但不会改已固定审核快照／企业历史版。

### 7.2 新企业全局默认接口

```http
POST /api/enterprise/capabilities/example-capability/default-version
```

```json
{ "versionId": "example-enterprise-version" }
```

仅本企业管理员，响应 `201`，直接返回 `{ capabilityId, versionId, version }`。允许此技能已通过的平台版，或本企业已通过企业版，包括切回历史企业版；不接受 PERSONAL 或未发布／跨企业版本。

该新接口不要求管理员本人有此技能的执行 grant／个人授权订阅，也不要求先取得或传入 `subscriptionId`；它按本企业管理员身份、企业技能可见性和目标发布版本资格校验。企业仍须有可见的该技能（例如企业有效技能订阅、保留的已发布企业版等），不是允许设置任意跨企业／无归属技能的默认。保留的企业历史版可在没有当前有效相关订阅时用于默认管理，后续执行仍须重新满足订阅与授权条件。

此操作更新持久化的“企业 + 技能”默认和相关有效订阅默认，不修改跨企业模板默认、不覆盖成员 PIN、不删除更新的企业版本。新 UI 优先使用此接口，不必挑一个订阅作为默认管理入口。

旧接口仍兼容：

```http
POST /api/enterprise/subscriptions/example-subscription/skills/example-capability/select-version
```

请求同为 `{ "versionId": "example-enterprise-version" }`，响应在新默认接口字段外保留 `subscriptionId`。服务端先验证该订阅属于本企业且有效、技能有绑定，然后执行**全企业默认切换**。路径中的 subscriptionId 仅用于兼容校验，不能解读为“只影响这个数字员工／订阅”，也不能用它设置本人的 PIN。

### 7.3 读取实际生效版本

`GET /enterprise/capabilities/:capabilityId/versions` 顶层 `currentVersionId/isCurrent` 指企业默认，不一定是本人实际执行版本。使用返回的 `subscriptions[]`：

```json
{
  "subscriptionId": "example-subscription",
  "enterpriseVersionId": "example-enterprise-version",
  "currentVersionId": "example-enterprise-version",
  "personalVersionId": "example-old-enterprise-version",
  "personalSelectionMode": "PINNED",
  "effectiveVersionId": "example-old-enterprise-version",
  "effectiveVersionScope": "ENTERPRISE",
  "canSelectPersonal": true
}
```

`personalVersionId` 是显式 PIN 的目标（可为 PERSONAL／ENTERPRISE／PLATFORM），字段名不代表必为个人作用域；FOLLOW 和 AUTO 都可能为 `null`，必须结合模式。`myPersonalVersionId` 只表示本人工作副本存在，不是实际生效证明。

数字员工技能接口对应的 `enterpriseVersion` 是企业默认，`currentVersion` 是本人解析结果。实际执行以服务端解析和执行授权为准，不能仅依靠客户端缓存、最新版本号或审核标签选正文。

## 8. 客户端刷新流程示例

### 8.1 必须刷新的时机与数据

1. 打开技能库／技能详情、回到前台或窗口重新聚焦时，重拉列表、该技能改动、时间线和原个人提交状态。
2. 保存成功、审核成功、本人选版成功、默认切换成功，以及处理 `409` 后，立即刷新相关数据；管理员再刷新兼容队列当前筛选／页码。
3. 前台审核相关视图约 30 秒轮询，退出视图或后台时停止。通知只作触发刷新提示，不是唯一状态来源；无需新增实时通信依赖。
4. 按原个人 ID 更新审核标签，按 `publishedVersionId` 获取企业版；FOLLOW 刷新默认指针，PIN 只更新展示，不写偏好。
5. 列表、详情、正文与选版缓存至少按企业、用户、技能、订阅和查询条件区分，切换身份／企业清理旧上下文；新响应替换当前状态，勿把旧待审状态覆盖新已审回执。

不要继承“缓存五分钟且禁止 mount／focus 刷新”而令审核结果长期不可见。队列审核移除最后一项后，如当前页超过总页数，回到合法页重拉。

### 8.2 应用层伪代码

以下 `api/cache/view` 是客户端现有封装的占位名，不要求新增依赖；请求头按第 2 节统一注入，示例无真实 token。

```ts
async function refreshSkill(capabilityId: string, originalPersonalId?: string) {
  const query = { capabilityId };
  const [visible, timeline, changes] = await Promise.all([
    api.get('/enterprise/skill-versions', query),
    api.get(`/enterprise/capabilities/${capabilityId}/versions`),
    api.get(`/enterprise/capabilities/${capabilityId}/personal-diffs`, {
      page: view.changesPage ?? 1, limit: 20,
    }),
  ]);
  cache.replaceSkill({ capabilityId, visible, timeline, changes });
  if (originalPersonalId) {
    // 管理员处理他人改动时，本人可见版本数组不包含该私有记录。
    const receipt = changes.items.find((row) => row.id === originalPersonalId)
      ?? visible.find((row) => row.id === originalPersonalId);
    if (receipt) view.updatePersonalReceipt(receipt);
    if (receipt?.publishedVersionId) {
      const published = await api.get(
        `/enterprise/skill-versions/${receipt.publishedVersionId}/preview`,
      );
      cache.replacePublishedVersion(published);
    }
  }
  // 刷新只更新展示，不调用 select-personal-version 或 default-version。
  await cache.refreshCapabilityList();
  if (view.canManage) await cache.refreshReviewPage();
}

async function submitSavedBody(operation) {
  // operation 持久保存原 Key 与原正文；新的编辑创建新的 operation。
  const receipt = await api.post('/enterprise/skill-versions', operation.body, {
    'Idempotency-Key': operation.key,
  });
  operation.markSaved(receipt.id);
  cache.replacePersonalReceipt(receipt); // 接受当前状态，不能硬编码为待审。
  try {
    await refreshSkill(receipt.capabilityId, receipt.id);
  } catch (error) {
    view.markRefreshPending(error); // 只重试查询，已成功保存不再上传。
  }
  return receipt;
}

async function reviewPreview(preview, decision, comment) {
  try {
    await api.post(`/enterprise/skill-versions/${preview.id}/review`, {
      decision, comment, expectedUpdatedAt: preview.updatedAt,
    });
  } catch (error) {
    if (error.status !== 409) throw error;
    view.requireNewReviewConfirmation();
    // 不自动拿最新 updatedAt 再审核；刷新后由管理员重新确认正文。
  }
  await refreshSkill(preview.capabilityId, preview.id);
}
```

网络失败时保留待提交 operation，通过认证恢复后重试同一提交请求。若保存已成功但后续刷新失败，保留成功回执并单独重试查询，不把保存显示成失败、不生成新 Key 再上传。为刷新结果增加当前上下文／请求序号保护，避免切换技能或企业后迟到响应污染页面。

## 9. 错误与兼容边界

| HTTP | 场景与处理 |
| --- | --- |
| `400` | 字段／时间格式／幂等键校验失败、来源能力不符、无效选版、驳回原因缺失；修正请求，不盲目重试 |
| `401` | access token 无效；沿用认证恢复，提交重试保持原 Key 和原请求体 |
| `403` | 来源头或企业角色／执行授权问题；区分来源错误与权限错误，不关闭 guard |
| `404` | 跨企业／不可见版本、技能不存在或提交无有效授权；刷新身份及授权，不传伪造归属绕过 |
| `409`（提交） | 同 Key 对应不同内容；核对原 operation，新保存用新 Key，不覆盖旧记录 |
| `409`（审核） | 重复处理、预览失效、多源缺少确认正文／正文不一致或合并冲突；重拉状态／正文／关联并重新确认，推荐单条审核，不自动重复发布 |

旧客户端可继续使用完整提交、队列分页／状态和不可变记录审核请求；新增字段缺失须降级展示，但不得在未知状态下开放新默认行为。历史已通过无关联记录仅由管理员显式发布；已有关联的记录重复审核返回冲突，不再次生成企业版。旧 Web adopt 与旧默认选版接口只作为兼容入口，不保留旧“通过不发布”或“单订阅默认”的业务语义。

迁移／部署顺序及生产验证属于发布任务，不属于本文编写范围。不得把 v1 的历史生产诊断当作 v2 新行为已在生产生效的依据。

## 10. 联调验收清单（待执行）

以下为目标环境验收项目，不是本文已完成的测试结果。使用测试企业、虚构正文和合法测试账号，由发布负责人确认环境已具备所需代码与迁移；不在示例或日志中输出真实 token。

- [ ] 普通成员与管理员保存个人内容均为 PERSONAL；管理员保存不直接发布。完整 frontmatter、CRLF／Unicode／尾空白可原样读回。
- [ ] 客户端保存返回 `201` 后，Web 对应技能改动里能找到同一 ID，待审统计正确，不依赖独立审核页。
- [ ] 本人可 PIN 待审／驳回个人记录并通过正常执行入口使用；其他成员和管理员均不能 PIN 他人的私有记录。
- [ ] 审核通过保留 PERSONAL ID，返回非空 `publishedVersionId`，新企业版正文对应审核内容，企业默认及相关有效订阅默认更新。
- [ ] 驳回返回原因和空发布关联，不创建企业版、不改默认；本人可修改后以新 Key 再提交。
- [ ] A 成员 PIN 个人版、B 成员 PIN 历史企业版、C 成员 FOLLOW：新发布后 A／B 不变、C 跟随新默认；之后新建相关订阅也解析同一企业默认。
- [ ] 管理员用新 `default-version` 切回历史企业版，FOLLOW 跟随、PIN 不变，新旧企业历史版仍在。旧 `select-version` 同样影响全企业，而非仅路径中的订阅。
- [ ] 未有显式记录的 AUTO 保留存量活跃副本优先；主动发送 `versionId:null` 后改为 FOLLOW，副本内容保留但不抢占默认。
- [ ] Web 预览后另一次保存，再用旧 `expectedUpdatedAt` 审核返回 `409`；重拉、重新确认后成功，企业版不会发布未预览的正文。
- [ ] Web 无一键批量入口；兼容多源请求缺少 `expectedMergedContent`、与服务端无冲突结果不一致、或存在合并冲突时均返回 `409`，审核状态／快照、发布关联、企业版及默认无写入；仅已确认正文完全一致且所有修订依据有效时才发布。
- [ ] 客户端单条不可变 submit 不要求 `expectedUpdatedAt`，回执含当前 `publishedVersionId`；不把多源最终正文确认字段发送到严格提交 DTO。
- [ ] 两名管理员并发／重复审核同一记录，仅产生一次企业发布，另一请求 `409`；重拉能定位已生成企业版。通知失败不伪报事务失败。
- [ ] 已通过后原 Key／原正文重试仍 `201`，返回原 ID、当前状态与同一发布关联；已驳回重试返回驳回，不重新排队；原 Key／不同正文 `409`。
- [ ] 队列 `page/limit/status/capabilityId` 兼容，Web `PERSONAL_ACTIVE` 按 `reviewStatus` 出现在正确筛选；个人改动无重复审核快照条目。
- [ ] personal-diffs 与兼容队列返回当前修订的衍生 `reviewedBy`；工作副本已审时取审核快照，`name:null`、整个字段 `null` 或旧响应缺失均可降级展示，不冒用作者、不据此更改审核状态。
- [ ] 历史已通过无关联记录明确显示未发布，列入已通过筛选且待处理；未自动补发，管理员显式发布一次后关联正确。
- [ ] 没有执行授权的本企业成员可查已发布企业版，管理员可审核／切默认，但无授权者仍不能编辑、个人选版或执行；跨企业请求被拒绝。
- [ ] 本企业已发布企业版 preview 不依赖本人执行 grant；新 default-version 不要求管理员本人有授权订阅或提供 subscriptionId，企业技能及目标版本仍须合法可见。与旧默认兼容接口仍校验路径中的有效订阅区分。
- [ ] 进入／聚焦／前台轮询和所有写操作后刷新生效；后台停止轮询，409 后重拉，保存成功而刷新失败不触发重复保存。
- [ ] 来源头缺失／非法及 Bearer 无效按目标环境预期拒绝；合法头请求能抵达业务校验，不用真实 token 写入文档／验收日志。

## 11. 源码核对入口

- `backend/src/shared/skill-version.dto.ts`：提交、幂等键、分页／状态、审核修订时间、本人选择及默认 DTO。
- `backend/src/modules/skill-version/skill-version.controller.ts`：全部企业接口与旧 Web／订阅兼容入口。
- `backend/src/modules/skill-version/personal-skill-submission.service.ts`：完整个人保存、幂等当前回执、本人可见列表、统一队列。
- `backend/src/modules/skill-version/enterprise-skill-review.service.ts`：归一化状态、工作副本快照、并发审核、发布关联与事务。
- `backend/src/modules/skill-version/enterprise-skill-default.service.ts`：企业级默认及相关有效订阅默认持久化。
- `backend/src/modules/skill-version/skill-version.service.ts`：工作副本、个人改动、默认管理、本人 PIN／FOLLOW、执行解析和时间线。
- `backend/src/modules/security/guards/csrf.guard.ts`：Origin／Referer 来源校验；本次未读取生产配置或验证生产链路。
