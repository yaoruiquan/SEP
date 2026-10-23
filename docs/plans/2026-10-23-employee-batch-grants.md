# 单个硅基员工批量授权开发文档

**Goal:** 企业管理员为一段雇佣关系，一次授权给多个成员或多个部门。

**Architecture:** 保留 EmployeeGrant 现有数据模型及单条接口，新增事务化批量接口。前端使用共享 Zod 契约和 TanStack Query mutation，替换单选下拉为搜索、多选列表，不新增依赖或数据库迁移。

**Tech Stack:** NestJS、Prisma/PostgreSQL、Zod、Next.js、React、TanStack Query、现有 Dialog/UI。

## 1. 范围与规则

- 一次操作固定一个 subscriptionId；成员和部门二选一，不混选，不支持多个硅基员工。
- 仅企业管理员可提交；雇佣关系和所有目标必须属于当前企业。
- ACTIVE 和 PAUSED 可配置授权；暂停时仍不可使用。EXPIRED、TERMINATED 或 endDate 已到期拒绝授权。
- 每批 1 至 100 个唯一、非空目标 ID；空数组、重复 ID、两种对象同时指定及未知字段拒绝。
- 同批统一有效期：长期、30 天、90 天或自定义未来时间。后端验证有限有效期必须晚于当前时间。
- 有效直接授权跳过，保留原有效期；过期授权默认跳过，仅勾选“重新开通过期授权”后更新原记录。
- 部门授权覆盖当前和后续加入的直属成员，不自动包含子部门。直接授权与部门授权保持 OR 关系。
- 成员即使已有部门授权也可新增直接授权；UI 标识部门来源，不擅自移除或替换权限路径。
- “全选本页”只影响当前页可选项；搜索、分页保留已选 ID。切换成员/部门清空选择。
- 重复提交不重复创建、不改变已有有效期。所有目标先校验，再写入；任一目标无效则整批不写入。

## 2. 共享接口契约

新增 `backend/src/shared/employee-grant.dto.ts` 并从 `shared/index.ts` 导出。

`POST /enterprise/subscriptions/:id/grants/batch`

成员请求示例：

```json
{
  "memberIds": ["member-a", "member-b"],
  "expiresAt": "2027-01-01T00:00:00.000Z",
  "renewExpired": false
}
```

部门请求将 `memberIds` 替换成 `departmentIds`。省略 expiresAt 表示长期；renewExpired 默认 false。

响应：

```json
{
  "target": "member",
  "createdIds": ["member-a"],
  "renewedIds": [],
  "skippedIds": ["member-b"]
}
```

- 200：整批处理完成，包含全部跳过的幂等请求。
- 400：请求无效、到期时间无效、雇佣终态或目标不属于本企业。
- 403：非企业管理员。
- 404：雇佣关系不存在或不属于本企业。
- 批量接口补齐 Swagger，并经共享 Zod DTO 校验后调用 service。

## 3. 事务与并发

- 在事务中校验管理员成员身份、所属企业、雇佣状态及目标归属。
- 使用 ReadCommitted 事务，锁定管理员身份及目标记录，并以雇佣记录的 FOR NO KEY UPDATE 锁串行化同一雇佣的批量写入，同时兼容旧单条新增的外键 KEY SHARE 锁；目标按 ID 稳定排序加 FOR SHARE 锁。
- 查询已有授权前按 ID 排序加 FOR UPDATE 锁，使续期与单条收回串行执行。有效记录不更新；过期续期更新原记录；新记录通过 createMany(skipDuplicates) 兼容已有部分唯一索引，旧单条接口并发先创建的目标计入跳过。
- 事务失败回滚，不用前端循环调用单条接口实现伪批量。
- 保留单条接口的重复 409 语义，同时补齐 TERMINATED 和过去时间的校验。
- 不在本功能增加批量撤销、企业全员动态权限或知识库权限。

## 4. 前端交互

- 替换自制小弹窗，复用现有 Dialog；固定标题和底部操作，中间内容滚动，适配手机窄屏。
- 顶部“新增授权 / 已有授权”视图，新建默认打开，避免已有授权把操作挤出首屏。
- 新增视图保留“给个人 / 给部门”分段切换，搜索、分页（每页 20）、全选本页、清空选择和已选数。
- 成员显示姓名、邮箱、部门/岗位；部门显示完整层级路径。有效直接授权禁选；过期记录在允许重开时可选。
- 明确区分部门来源和直接授权，部门来源不禁止直接授权；有效期使用共享 schema 做提交校验。
- 成功反馈“新增 N、重新开通 N、跳过 N”，清空选择并刷新已有授权、我的员工、雇佣统计和相关组织视图。
- 请求中禁止重复提交及修改选择，失败保留选择并显示错误、允许重试。候选/授权读取失败不能当空列表处理。
- 已有授权保留查看到期时间及单条收回，收回部门权限时显示来源，避免误认为个人权限也随之撤回。

## 5. 开发步骤与文件

1. 共享契约：`backend/src/shared/employee-grant.dto.ts`、导出 `backend/src/shared/index.ts`、DTO spec；批量路由 `backend/src/modules/enterprise/enterprise.controller.ts`。
2. 后端事务：`backend/src/modules/enterprise/grant.service.ts` 与 `grant.service.spec.ts`。
3. 前端多选：`web/src/features/enterprise/grant-panel.tsx`、`__tests__/grant-panel.test.tsx`。
4. 缓存更新：`web/src/features/enterprise/use-enterprise.ts` 新增 useCreateGrants，保留单条 hook，批量新增及单条收回后刷新授权列表、我的员工与雇佣列表（含订阅员工子缓存），以 `__tests__/use-grants.test.tsx` 验证。
5. 整体验证：定向测试、typecheck、改动文件 lint，浏览器桌面/手机多选提交、分页及滚动截图；本地 PostgreSQL 验证真实并发和 HTTP 参数校验。
6. 将实际完成项、命令结果与未验证项补充到本文档；实现阶段不自动提交，review 修复后按用户要求提交 Git，不推送。

## 6. 验收

- 多成员、多部门分别一请求完成；搜索与跨页选择保留，提交总数正确。
- 同名成员可辨识；有效记录跳过、过期记录明确重开，重复请求不延长有效期。
- 跨企业、非管理员、终态雇佣、过去有效期和无效 ID 均拒绝，失败不产生部分写入。
- 同一雇佣的并发批量提交不创建重复记录，已有权限路径不改变。
- 未授权零选择不能提交；加载、失败、空状态、最多 100 个及请求中状态完整。
- 已有单条收回、部门动态覆盖、暂停恢复及原单条接口不回归。
- 桌面与手机弹窗底部按钮可见，长候选及已有授权列表可滚动。

## 7. 执行记录

- [x] 文档完成，范围与接口契约确定。
- [x] 共享契约及后端完成。
- [x] 前端批量交互及缓存更新完成。
- [x] 自动测试与浏览器验证完成。

已完成的验证：

- 本地 PostgreSQL 中 4 个并发批次创建 2 个成员授权，其余目标跳过；3 个并发过期重开请求只续期一次，有效记录的原有效期保持不变。
- 本地 HTTP 批量接口正常返回 200；空数组、混传、重复及未知字段返回 400，非管理员返回 403。
- 浏览器采用隔离的 API 测试数据：45 名成员跨页选择后一次提交 2 人成功；手机一次为 2 个部门设置 30 天期限成功。桌面与 390×844 手机弹窗可滚动到底部，有效期设置及底部按钮可见。
- 浏览器截图在 `output/playwright/batch-grants-*.png`；数据库与 HTTP 验证脚本在 `output/playwright/batch-grants-db-check.cjs`，只允许连接本地数据库，创建的临时记录在验证后清理。`output/` 为本地验证产物，不加入 Git。

自动检查结果：

| 检查 | 结果 |
| --- | --- |
| `pnpm --dir backend exec jest --runInBand src/modules/enterprise/grant.service.spec.ts src/shared/employee-grant.dto.spec.ts` | review 后 35/35 通过 |
| `TZ=America/Los_Angeles pnpm --dir web test src/features/enterprise/__tests__/grant-panel.test.tsx src/features/enterprise/__tests__/use-grants.test.tsx 'src/app/(enterprise)/subscriptions/page.spec.tsx'` | review 后 18/18 通过，包含本地时间回归 |
| `pnpm --dir backend typecheck` | 通过 |
| `pnpm --dir web exec tsc --noEmit --incremental false` | 通过 |
| `pnpm --dir backend build` / `pnpm --dir web build` | 均通过 |
| 改动文件 ESLint | 前端及后端 service/DTO/spec 无错误或告警；controller 无错误，保留 3 条既有未使用导入告警 |
| 本地 PostgreSQL 与 HTTP | review 后 11 项场景通过，新增旧单条新增与批量交错、收回与多目标续期交错；临时数据已清理 |
| Playwright 桌面/手机 | 批量成员和部门提交通过；手机滚动内容 1998px、容器 549px，底部提交按钮完整可见 |

review 后再次用 Playwright 验证：重复点击对象类型保留选择、跨页选择两名成员、本地自定义未来时间一次提交成功，已有授权显示过期日期。重新检查桌面和 390×844 手机截图，底部提交按钮完整可见；截图为 `output/playwright/batch-grants-review-desktop.png` 和 `batch-grants-review-mobile.png`。

验证范围：未运行全仓测试、未连接外部生产环境。浏览器交互使用隔离的 API 测试数据，本地 HTTP 与 PostgreSQL 验证独立执行；未做生产规模压测。工作区已有的 Prisma schema 修改与本功能无关，未修改或恢复，不纳入本次提交；本功能不新增依赖、不新增迁移，按用户本轮要求提交，不推送。

### Review 修复

- 规范与并发审查：修复批量与旧单条新增锁冲突、续期读取后被并发收回导致整批回滚两项问题，并用本地 PostgreSQL 控制事务交错验证。
- 需求审查：自定义时间最小值改用本地时间；候选读取失败不再遮住已成功加载的已有授权；恢复过期授权的具体到期日期。
- 补充交互回归：重复点击当前“给个人 / 给部门”不清空选择。

本地入口：`http://localhost:3000/subscriptions`，选择某个硅基员工的“授权”后即可多选成员或部门提交。
