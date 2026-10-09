# 客户端与 Web 个人 Skill 企业审核闭环开发方案 v1

- 日期：2026-10-08
- 范围：SEP 后端与 Web；客户端按本文接口契约对接，客户端仓库实现不在本次范围内。
- 目标：客户端或 Web 的个人 Skill 送审记录进入同一个企业队列，企业管理员审核后提交人可查询结果并自主选用，不改变其他成员或企业默认版本。

## 1. 问题与证据

此前诊断已确认客户端回执中的版本 `psv_0533f3eb6fe840bcfc6df73d605fb315fc68d0e1cad82332d8218e141ba2257e` 写入生产 `skill_versions`，企业为 `demo-ent-shuyi`，状态为 `PENDING_ENTERPRISE_REVIEW`，提交时间为 `2026-10-08T08:48:26.730Z`（北京时间 16:48:26.730）。本次开发不再次访问或修改生产数据库。

后端提交服务在写库成功后返回 201。Web `/audit` 展示的是 `/audit-logs` 操作日志；平台 `/admin/contributions`、`/admin/skill-versions` 是其他业务队列。Web 缺少 `/enterprise/skill-version-reviews` 的消费页面，不能据此认定客户端上传失败。

进一步源码核查发现：当前本人选版 / 执行解析只认 `PERSONAL_ACTIVE`，技能时间线也未列出本人送审版本。因此本次还需允许本人 `PERSONAL / ENTERPRISE_APPROVED` 显式选择与执行，并在时间线展示本人送审记录；仅补审核页面不足以完成闭环。

## 2. 业务边界：统一记录，不建立两套审核

| 场景 | 版本范围 / 状态 | 审核者 / 效果 |
| --- | --- | --- |
| 个人 Skill 显式送审（客户端，或 Web 后续接入同一提交接口） | PERSONAL / PENDING_ENTERPRISE_REVIEW | 本企业管理员审核，通过后仅提交本人可选用 |
| 已有 Web 工作副本 | PERSONAL / PERSONAL_ACTIVE | 保留现有可编辑、可选用行为，不强制改为送审 |
| 企业管理员发布企业标准 | ENTERPRISE / ENTERPRISE_APPROVED | 保留现有管理员直接发布流程，不增加自审仪式 |
| 企业向平台公开投稿 | PLATFORM / PENDING_PLATFORM_REVIEW | 平台管理员审核，与个人企业审核隔离 |

所有个人送审都使用 `skill_versions` 与现有企业审核 API，入口来自客户端还是 Web 不决定权限。不得向平台审核队列复制个人送审数据；`/audit` 仍仅提供操作日志。

本次不新增 Web 上传表单，不迁移已有工作副本，不自动采纳个人版本为企业版，不新增推送通知、依赖或数据库迁移。

## 3. 状态、身份与权限

```text
已授权技能的本人修改
  → POST /api/enterprise/skill-versions（完整正文 + 幂等键）
  → PERSONAL / PENDING_ENTERPRISE_REVIEW
  → 本企业管理员预览正文、审核
     ├─ APPROVE → ENTERPRISE_APPROVED → 提交人查询结果 → 主动选择该版本
     └─ REJECT  → ENTERPRISE_REJECTED → 提交人查询驳回原因 → 修改后以新幂等键再提交
```

- 企业身份由服务端根据 JWT 用户解析，不接受请求体指定 `enterpriseId` / `ownerId`。
- 审核只允许 `ENTERPRISE_ADMIN`，平台管理员身份不能代替企业成员管理员身份。
- 队列同时过滤本企业、`scope=PERSONAL`、`submittedAt != null`、查询状态。
- 正文预览复用 `/enterprise/skill-versions/:id/preview`，企业管理员可查看本企业送审个人版本。
- 审核正文不可修改；事务内更新待审状态并写 `skill_version_reviews`，并发或重复审核返回 409。
- 审核不会写企业默认选版或成员选版；选择版本是独立操作。
- 待审 / 已驳回个人版本不可选用，他人的个人版本不可选用。`PERSONAL_ACTIVE` 仍保留已有规则。

## 4. API 契约

### 4.1 提交

```http
POST /api/enterprise/skill-versions
Authorization: Bearer <accessToken>
Origin: https://longdaosep.cn
Referer: https://longdaosep.cn/
Idempotency-Key: <16-128 位字母数字、下划线或连字符>
Content-Type: application/json
```

```json
{
  "capabilityId": "<技能ID>",
  "parentVersionId": "<本人可访问的来源版本ID>",
  "content": "<保留 frontmatter、换行和尾部空白的完整 SKILL.md>",
  "changeSummary": "本次改动说明"
}
```

201 返回已保存版本的 `id`、`capabilityId`、`enterpriseId`、`ownerId`、`scope`、`status`、`submittedAt`、`content` 等字段。保存回执不等于审核通过；以返回的实际 `status` 为准。同一次保存重试复用幂等键；内容变化使用新键。重复键、相同内容返回同一版本的当前状态，不将已审核版本重置为待审；重复键、不同内容返回 409。

### 4.2 企业审核列表

```http
GET /api/enterprise/skill-version-reviews?status=PENDING_ENTERPRISE_REVIEW&page=1&limit=20
Authorization: Bearer <企业管理员 accessToken>
```

支持 `capabilityId` 精确筛选，`page >= 1`，`1 <= limit <= 100`；状态支持 `PENDING_ENTERPRISE_REVIEW`、`ENTERPRISE_APPROVED`、`ENTERPRISE_REJECTED`，默认待审核。

```ts
{
  total: number;
  page: number;
  limit: number;
  items: Array<{
    id: string;
    capabilityId: string;
    parentVersionId: string | null;
    enterpriseId: string | null;
    ownerId: string | null;
    scope: 'PERSONAL';
    version: string;
    status: string;
    changeSummary: string | null;
    submittedAt: string | null;
    enterpriseReviewedAt: string | null;
    rejectionReason: string | null;
    createdAt: string;
    updatedAt: string;
    capability: { id: string; name: string; description: string };
    owner: { id: string; name: string | null; email: string } | null;
  }>;
}
```

本次仅为审核列表补充 `capability` 与 `owner` 展示字段，保持其他字段与提交回执兼容；列表不返回完整正文。Web 对未升级后端的关联字段缺失回退显示 ID。

### 4.3 预览与审核

```http
GET /api/enterprise/skill-versions/:id/preview
POST /api/enterprise/skill-versions/:id/review
```

审核请求复用共享 `ReviewSkillVersionDtoSchema`：

```json
{ "decision": "APPROVE" }
```

```json
{ "decision": "REJECT", "comment": "请补充输入字段与异常处理说明" }
```

`comment` 最多 2000 字符，驳回必须填写非空原因。201 返回更新后的版本（通过 `ENTERPRISE_APPROVED` / 驳回 `ENTERPRISE_REJECTED`）。

### 4.4 客户端结果同步与自主选版

本人查询：

```http
GET /api/enterprise/capabilities/:capabilityId/skill-versions
Authorization: Bearer <提交人 accessToken>
```

客户端按提交回执 `id` 匹配该列表中的记录，读取 `status`、`enterpriseReviewedAt`、`rejectionReason`。建议进入技能详情、恢复窗口焦点时刷新；有待审记录且窗口前台时每 30 秒轮询，进入终态后停止。轮询失败不得把已保存记录标为上传失败，也不要改幂等键反复上传。本次实现 Web 队列前台每 30 秒刷新、进入页面 / 恢复焦点刷新及手动刷新，不宣称已修改客户端轮询代码。

本人选版使用个人选择接口，不能使用管理员企业默认接口：

```http
POST /api/enterprise/subscriptions/:subscriptionId/skills/:capabilityId/select-personal-version
Content-Type: application/json

{ "versionId": "<已通过的本人个人版本ID>" }
```

`versionId: null` 表示主动跟随企业默认。选择写 `member_skill_version_selections`，不写 `subscription_skill_versions`。执行时按使用者解析本人选择，企业默认变化不覆盖明确的个人选择。选版仍要求有效订阅和本人授权。

### 4.5 错误与安全

| 状态码 | 场景 / 客户端处理 |
| --- | --- |
| 400 | DTO 无效、来源技能不匹配、驳回未填原因、所选版本不可用 |
| 401 | access token 无效，走现有刷新 / 重新登录流程，不用 refresh token 当 access token |
| 403 | 来源校验失败或非企业管理员；区分响应原因，不关闭来源 / 权限校验 |
| 404 | 无授权、版本不可访问或非本企业送审记录，禁止跨企业枚举 |
| 409 | 幂等键内容冲突或该版本已经审核；审核页刷新队列，不盲目重试相同决策 |

保留 Origin / Referer、JWT 和企业权限校验。Token 不写开发文档、截图、日志或 Git。配置细节沿用 `docs/对接/SEP客户端技能提交与企业审核接口对接文档-v1.md`。

## 5. Web 实现方案

- 企业侧新增 `/skill-reviews` 路由，导航在「组织能力」组，只有企业管理员可见。
- 页面权限体验拦截 + 服务端权限双层校验，普通成员直接访问显示无审核权限，不发送队列请求。
- 三个状态页签：待审核（默认）、已通过、已驳回；支持分页，每页 20 条，切换状态回第 1 页。
- 支持技能 ID 精确筛选；显示技能名称 / ID、提交人 / ID、版本号、版本 ID、变更说明、提交 / 审核时间、状态、驳回原因。
- 复用 `SkillVersionPreviewDialog`，预览用 `source="enterprise"`，并修正个人版本标题误标为企业版本的问题。
- 待审核记录支持通过、填写原因后驳回；已审核记录只读；mutation 进行中禁止重复操作，错误保留上下文。
- 复用共享 Zod 审核 schema 校验，前端不复制审核规则；403 提示权限限制，409 提示已审核并刷新。
- 审核成功失效 `skill-versions`、`capability-iteration` 相关缓存，避免预览、本人版本列表或时间线显示旧状态。
- 恢复企业审核状态标签，不再将待企业审核称为「历史待审」。管理员企业草稿发布规则不变。

## 6. 分工与变更位置

| 内容 | 文件 |
| --- | --- |
| 开发方案 | 本文 |
| 队列关联显示 / 回归测试 | `backend/src/modules/skill-version/personal-skill-submission.service{,.spec}.ts` |
| 同库送审到审核及选版边界测试 | 同服务测试、`skill-version-selection.spec.ts` |
| 本人已审个人版选用与执行、本人送审时间线 | `backend/src/modules/skill-version/skill-version.service.ts`、`skill-version-usage.spec.ts` |
| 本人通过版本选用入口 / 回归测试 | `web/src/features/capability-iteration/version-timeline-panel{,.spec}.tsx`、`use-capability-iteration.ts` |
| 响应类型 | `web/src/lib/types.ts` |
| 查询 / mutation / 缓存失效 | `web/src/features/skill-version/use-skill-version.ts` |
| 页面 / 路由 / 测试 | `web/src/features/skill-version/enterprise-skill-review-page{,.spec}.tsx`、`web/src/app/(enterprise)/skill-reviews/page.tsx` |
| 导航 / 状态 / 预览 | `enterprise-shell.tsx`、`status.ts`、`SkillVersionPreviewDialog.tsx` |

## 7. 验收与回归

1. 服务测试证明完整正文持久化、幂等重试、企业隔离、仅个人送审入队、关联字段白名单、分页一致、审核事务、重复审核冲突、不写企业默认。
2. 增加送审 → 同 ID 入队 → 预览 → 审核 → 本人列表读取终态的回归覆盖；选版测试覆盖本人已通过可选、待审 / 已驳回 / 他人不可选。
3. Hook 测试验证正确 URL、状态 / 技能 / 分页参数、成功缓存刷新、失败不误刷、普通身份禁用查询。
4. 页面测试使用真实 Hook 与 API mock 验证默认待审、筛选分页、预览授权路径、通过、必填驳回、403 / 409、已审只读、客户端回执 ID 可展示，不使用平台投稿或操作日志接口。
5. 运行针对性后端 Jest、前端 Vitest、两端 typecheck；适用时 build / lint。未执行项必须明确列出。
6. 用户此前要求不再打开浏览器，本次不做浏览器实测，不把 DOM 测试或编译通过视为真实视觉验收。

## 8. 上线与回滚

无需本次专属数据库迁移。先部署审核列表关联字段的后端补丁，再部署 Web；已有客户端提交记录会直接出现，无需重传或回填。环境、企业管理员身份、状态筛选一致才可查询到目标记录。

注意：工作区已有员工自主选版及其数据库迁移是另一项在途改动，若一并部署需按其独立发布步骤执行，本文不能代替其迁移验收。

生产联调由企业管理员确认目标版本出现 → 查看内容 → 按业务授权通过 / 驳回 → 提交人在客户端读取新状态 → 主动选用 → 检查执行使用该版本；不得未经授权审核真实记录或自动改生产数据。

回滚可回退本次 Web 路由、导航及列表关联字段变更；既有提交、审核接口和数据库记录继续保留，不撤销历史审核或删除版本。


## 9. 本次实施与验证记录（2026-10-08）

本方案中的 SEP 后端与 Web 代码已实现。审核队列、预览、通过 / 驳回、本人送审记录展示、本人已通过版本的显式选择与执行解析已补齐；没有新增客户端代码或本次专属数据库迁移。

| 验证 | 结果 |
| --- | --- |
| `pnpm --dir backend exec jest --runInBand src/modules/skill-version` | 7 个测试套件、152 个测试通过；通知失败日志是异常路径测试的预期输出 |
| `pnpm --dir web exec vitest run src/features/skill-version src/features/capability-iteration` | 9 个测试文件、75 个测试通过 |
| `pnpm --dir web exec tsc --noEmit --incremental false` | 通过 |
| `pnpm --dir backend run typecheck` | 通过 |
| 本次页面、Hook、预览、状态及时间线相关文件的 ESLint | 0 错误；时间线原有 `window.location.href` 导航有 1 条警告，未扩大范围修改 |
| `pnpm build` | 后端、Web 生产构建通过，新增 `/skill-reviews` 路由成功生成 |
| `git diff --check` | 通过 |

未执行：真实浏览器视觉验收、生产队列查询 / 审核、真实桌面客户端联调和部署。单元测试使用 mock，不等于真实数据库端到端验收。本次未提交或推送 Git。
