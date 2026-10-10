# SEP 客户端技能提交与企业审核接口对接文档 v3

- 日期：2026-10-10。
- 依据：`docs/development/技能库客户端修改与Web审核启用改造方案-v2.md` 和本工作区实现。
- 状态：本地接口契约；不声明线上部署、真实客户端接入或生产历史数据联调已完成。
- 替代：对接 v2 中个人 PIN、自用工作副本、Web 正文编辑和企业投稿平台的规则。认证、提交幂等和来源可见性契约不变。

## 1. 新业务闭环

```text
客户端修改完整 SKILL.md
  → 保存不可变 PERSONAL / PENDING_ENTERPRISE_REVIEW 记录
  → 企业管理员逐条审核原文
      通过：保留原记录 + 新 ENTERPRISE / ENTERPRISE_APPROVED 版本 + 自动启用
      驳回：保留原因，不生成企业版，不改变企业启用
  → 两端刷新正式 runtime，按返回的 versionId/content 执行

运营监控所有来源和状态
  → 选择原始来源生成 PLATFORM 待审副本
  → 平台审核通过后发布，企业审核和启用不受影响
```

1. 企业／个人 Web 不再创建副本、编辑正文、替换包或直接发布草稿。只有运营后台保留首次创建技能。
2. 客户端保存只代表提交已持久化，不代表该内容可用于正式云端执行或正式客户端任务。
3. 正式执行统一跟随企业启用版本；历史个人 PIN、FOLLOW 和 Web 工作副本记录保留，但不参与正式版本解析。新的个人选版请求返回停用错误。
4. 客户端可以在本地编辑和测试未审核内容，但不得把本地测试结果、文件保存或提交成功当作企业正式启用。
5. 企业管理员可以启用历史已通过的本企业版或平台版。按钮统一为“启用”，不是仅切换管理员自己的使用版本。
6. 企业不再投稿平台。运营可选择企业待审、驳回及历史版本；平台通过不反写企业审核或默认。

## 2. 地址与认证

`API_BASE_URL` 已包含 `/api`，下表路径均相对于它。使用现有 access token；不改变登录、refresh、企业切换或授权协议。

```http
Authorization: Bearer <accessToken>
Origin: <目标环境允许的 Web 来源>
Referer: <同一允许来源>/
Content-Type: application/json
```

企业写请求仍由现有来源 guard 校验，生产缺少来源头会被拒绝。Bearer 与来源头不能互相替代，非法 Origin 不因合法 Referer 放行。Electron／Node 网络层须保留这些头，不能通过放宽权限解决来源问题。

本期关闭旧 Web 专用接口，但没有新增独立的可信客户端身份。共享上传和完整正文提交接口仍依据认证、来源及业务授权校验；不能仅凭隐藏 Web 按钮宣称服务器可以识别请求来自客户端。

## 3. 接口速查

| 方法和路径 | 用途 |
| --- | --- |
| `POST /enterprise/skill-versions` | 客户端完整正文提交，必带 `Idempotency-Key` |
| `GET /enterprise/skill-versions?capabilityId=:id` | 本人提交和可见版本摘要，查询 `publishedVersionId` |
| `GET /enterprise/skill-versions/:id/preview` | 授权预览完整正文，读取不会授予执行权限 |
| `GET /enterprise/capabilities/:id/personal-diffs` | 技能详情改动与企业基线，支持分页和审核状态 |
| `GET /enterprise/skill-version-reviews` | 企业管理员兼容审核队列，支持分页和状态 |
| `POST /enterprise/skill-versions/:id/review` | 逐条审核，通过并自动启用 |
| `GET /enterprise/capabilities/:id/versions` | 版本时间线和当前企业启用信息 |
| `POST /enterprise/capabilities/:id/default-version` | 管理员启用已通过版本，路径保持兼容 |
| `GET /client/subscriptions/:id/runtime` | 已授权订阅正式运行清单 |

## 4. 完整正文保存与幂等

```http
POST /enterprise/skill-versions
Idempotency-Key: skill_save_20261010_example_0001
```

```json
{
  "capabilityId": "example-capability",
  "parentVersionId": "example-approved-version",
  "content": "---\nname: example-skill\ndescription: 示例技能\n---\n\n# 工作方法\n先确认数据范围。\n",
  "changeSummary": "补充范围确认步骤"
}
```

- `capabilityId/parentVersionId` 各 1～128 字符；`content` 为 1～500,000 字符；可选 `changeSummary` trim 后最多 2,000 字符。
- DTO 为严格对象。不发送 `enterpriseId/userId/ownerId/scope/status/version/subscriptionId` 或包字段，身份和版本由服务端决定。
- 完整 `SKILL.md` 保留 frontmatter、Unicode、LF／CRLF 和尾部空白。客户端不 trim、转行、渲染后重建或截断 `content`。
- 来源须属于同一能力且对本人可见；仍校验有效订阅、启用的 SKILL 绑定与本人／部门授权。能力不匹配为 `400`，不可见或未授权为 `404`。
- Key 长度 16～128，只允许字母、数字、`_`、`-`。新保存用新 Key；响应丢失等重试使用原 Key 和原请求体。

首次 `201` 回执为原个人记录，`scope=PERSONAL`、`status=PENDING_ENTERPRISE_REVIEW`、`publishedVersionId=null`，含 `id/content/submittedAt/updatedAt`。同 Key 同请求返回同一 ID 的当前审核状态；同 Key 不同内容为 `409`，不会覆盖旧记录。

审核通过后的重试仍返回原个人 ID、`status=ENTERPRISE_APPROVED` 和已有 `publishedVersionId`，不重复发布、不重新排队。真正的新修订用新 Key。重试会再次校验权限，不保证授权撤销后仍可读取回执。

当前提交 DTO 没有新增包替换协议。本期审核和平台收录复制所选版本已有的包信息；客户端完整 zip 更新需要另行约定，不能把包字段塞入正文提交或调用已停用的贡献中心包替换接口。

## 5. 审核、历史与冲突

```http
POST /enterprise/skill-versions/example-personal-submission/review
```

```json
{
  "decision": "APPROVE",
  "expectedUpdatedAt": "2026-10-10T01:00:00.000Z"
}
```

`decision` 为 `APPROVE/REJECT`；驳回必填 `comment`，最多 2,000 字符。审核由本企业管理员操作，不要求管理员本人有执行 grant，不允许跨企业。

通过在同一事务固定审核内容、记录审核、生成企业版本及来源关联、同步企业启用与有效订阅默认。响应 `publishedVersionId` 指向新企业版本，原个人 ID 和作用域不变。驳回不生成企业版、不动默认。

历史 Web 工作副本仍可只读审核，必须携带预览的 `updatedAt` 作为 `expectedUpdatedAt`。兼容 `POST /enterprise/capabilities/:id/adopt` 仅接受单条原始来源；多条合并或 `expectedMergedContent` 返回 `400`，Web 不改审核正文。

收到 `409` 时重拉详情和审核状态，不自动重试批准旧预览。重复审核不能产生第二份企业版本；历史已通过未发布记录须管理员显式确认，不由客户端自动补发。

改动／队列字段仍包含 `reviewStatus/publishedVersionId/isWorkingCopy/isLegacyUnpublished/pending/reviewedBy`。`isWorkingCopy` 只表示历史来源，不表示可编辑；`canEdit=false`、`myWorkingCopy=null`。审核人可为空，不用内容作者冒充审核人。运营冻结的来源快照不代表企业已通过。

时间线顶层 `currentVersionId` 表示显式企业启用或订阅默认；没有显式选择时可为 `null`，不能据此认定没有可执行的平台回退版本。每个 `subscriptions[]` 的 `effectiveVersionId` 与 `enterpriseVersionId` 按正式解析返回。旧个人使用字段兼容为 `personalVersionId=null`、`personalSelectionMode=FOLLOW_ENTERPRISE`、`canSelectPersonal=false`。不得据个人记录时间或版本号推断正式生效。

## 6. 启用与正式运行缓存

```http
POST /enterprise/capabilities/example-capability/default-version
```

```json
{ "versionId": "example-approved-enterprise-version" }
```

只允许本企业已通过企业版或已通过平台版。启用是企业全局动作，会记录操作者、时间、前后版本并同步相关有效订阅；同一版本重复启用不伪造切换历史。

无企业显式启用时，解析按有效订阅默认、有效模板默认、最新已通过平台版回退；每级均排除个人版本、错误能力、未通过或其他企业版本。无合法版本时 runtime 不下发该技能，带订阅的云端 SKILL 执行不会退到静态模板。

客户端以 `GET /client/subscriptions/:id/runtime` 的 `runtime.skills[]` 为正式来源，每项含 `capabilityId/name/description/versionId/version/content`。清单仅包含启用的 SKILL 绑定，订阅、期限和授权仍由现有 runtime 校验。

- 按订阅、能力及 `versionId` 管理缓存，正文严格采用 runtime 返回值。
- 本地编辑目录和正式运行缓存分开，未审提交不能覆盖正式缓存。
- 审核结果或启用变化后重新获取 runtime；再次开始正式任务前刷新，不能仅沿用提交成功时的缓存。
- 新 runtime 中消失的技能不得继续从旧缓存执行；执行归因记录实际 `versionId`，不是个人提交 ID。
- 本期未新增缓存推送或轮询协议，桌面端须在独立仓库完成刷新与任务生命周期接入。

## 7. 已停用的旧入口

合法旧请求返回 `403`，参数无效仍可能先返回校验错误。历史数据保留，不执行删除、重置或迁移。

| 旧入口 | 新规则 |
| --- | --- |
| `POST /enterprise/capabilities/:id/personal-version` | 不再创建 Web 个人副本 |
| `PATCH /enterprise/personal-versions/:id` | 历史副本只读 |
| `DELETE /enterprise/personal-versions/:id` | 不从 Web 弃用历史副本 |
| `POST /enterprise/subscriptions/:id/skill-versions` | 不再创建 Web 企业草稿 |
| `PATCH /enterprise/skill-versions/:id` | 不再改写企业正文 |
| `POST /enterprise/skill-versions/:id/publish` | 不再直接发布 Web 草稿 |
| `POST /enterprise/subscriptions/:id/skills/:capabilityId/select-personal-version` | PIN 和 `versionId=null` 均停用 |
| `POST /enterprise/skill-versions/:id/submit-platform-review` | 企业不再投稿平台 |
| SKILL 贡献创建、编辑、包替换、版本发布及平台申请 | 按类型停用；其他能力原流程保留 |
| AI 建议正文采纳 | 停用正文生产，分析和拒绝保留 |

旧 `select-version` 默认接口仍兼容管理员设置企业全局启用，不是个人选版。旧 Web 编辑 URL 授权预览后跳转只读技能详情。

## 8. 运营独立处理

运营通过 `GET /admin/skill-versions` 全量分页监控，独立筛选来源、产生方式、企业审核、平台处理、归属和时间；企业与个人无权访问此后台。

个人／企业来源通过 `POST /admin/skill-versions/:id/adopt` 选择，`mode` 只允许 `DRAFT`，不能 `PUBLISH` 绕过审核。平台记录直接使用其待审／驳回重送／审核流程，不复制自身。

企业私有技能首次收录生成独立平台 Capability；后续来源复用持久来源映射。审核只发布所选平台版本，沿用正文与包安全门禁。原企业其他版本、审核、默认和私有元数据不公开。

平台版本通过、能力市场公开、绑定市场数字员工是三个不同状态，不能把审核通过解释为已自动创建市场商品或绑定。此过程不是客户端或企业投稿动作。

## 9. 发布与联调清单

1. 协调服务端和客户端发布顺序，客户端先移除正式个人 PIN 和旧 Web 副本调用。
2. 隔离环境核验完整正文与幂等、审核通过自动启用、驳回不变默认、`409` 重拉。
3. 核验同一企业不同成员及云端／桌面 runtime 的正文与实际 `versionId` 一致，历史 PIN 不抢占。
4. 核验订阅失效、撤销授权、禁用绑定和技能移除时正式缓存不会继续执行。
5. 核验运营收录和发布不改变企业审核、私有归属或启用，市场读取和包下载来自精确通过的版本。

本工作区没有桌面客户端源码。本地单元测试、类型检查、构建和模拟 API 页面验收不能替代上述真实客户端、事务并发及生产历史数据联调。
