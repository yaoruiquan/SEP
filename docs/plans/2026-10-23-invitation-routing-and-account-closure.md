# 邀请分流与账号注销开发文档

**Goal:** 已有账号可登录接受邀请，换企业通过退出企业完成；账号经邮件确认立即注销，唯一成员管理员可同时关闭企业。

**Architecture:** 保留 User 与 EnterpriseMember 的分离，以有效邀请为上下文决定注册或登录，不开放任意邮箱注册状态查询。注销前检查资金、任务与企业归属，邮件证明绑定操作范围；同一事务关闭企业并匿名化账号，不提供撤回或找回入口，不将注销作为入职条件。

**Tech Stack:** NestJS、Prisma/PostgreSQL、Next.js App Router、TanStack Query、共享 Zod、Jest/Vitest。

**执行方式:** 按用户要求先提交第一期（`36b7af3`），再实施第二期。第二期完成后按用户后续要求提交，由用户进行实际测试，不自动推送。

## 1. 问题与现状

- 已有账号打开邀请时仍显示注册表单。注册验证码接口对已有邮箱不发送邮件，但返回统一响应，用户因而一直等待验证码。
- `InvitationService.acceptByUser()` 已支持已有账号入职，但企业归属检查在写事务外，不能完整保护同一用户接受不同邀请的并发。
- `POST /auth/leave-enterprise` 和个人设置的退出企业入口已存在；唯一管理员不能直接退出。
- 退出后固定跳往 `/no-enterprise`，不能返回刚才的邀请。
- User 只有 ACTIVE/DISABLED，尚无账号注销生命周期。User 关联企业审计、工作、钱包等数据，不可直接删除整行。
- 本地开发邀请必须使用本地 WEB_BASE_URL；生产邀请必须由生产环境创建，不可跨环境使用 token。

## 2. 产品规则

| 受邀人状态 | 邀请方 | 受邀方 |
| --- | --- | --- |
| 没有账号 | 正常发送 | 验证邮箱、设密码、注册并加入 |
| ACTIVE、无企业 | 正常发送 | 登录并确认加入，不发送注册验证码 |
| 已在邀请企业 | 创建/重发时提示已是成员 | 登录后显示已加入，提供进入企业入口 |
| ACTIVE、已在其他企业 | 正常发送，不泄漏原企业 | 本人登录后先退出原企业，再回到邀请确认加入 |
| 非 ACTIVE | 不泄漏账号状态和原企业 | 有效邀请页提示账号暂不可用，联系支持 |

- 保持当前一账号一企业规则；接收邀请不自动退企业、不自动转移角色。
- 企业还有其他成员时，唯一管理员先安排其他管理员再退出；企业仅剩本人且本人为管理员时，可经邮件确认同时关闭企业并注销账号。
- 邀请有效不等于已登录。已有账号必须通过现有登录方式证明身份，持邀请链接不能重置已有账号密码。

## 3. 第一期接口

### 3.1 有效邀请预览

`GET /auth/invitations/verify?token=...` 在现有响应增加必需字段：

```ts
type InvitationNextAction = 'REGISTER' | 'LOGIN' | 'CONTACT_SUPPORT';

// 保留原有 email、enterprise、role、department、expiresAt 等字段。
// 只有有效邀请才查询邮箱账号；不返回账号 ID、状态或原企业信息。
{ nextAction: 'LOGIN' }
```

- token 不存在、已过期、撤回或已使用：仍统一 400，不查询 User。
- 有效邀请：User 不存在返回 REGISTER；ACTIVE 返回 LOGIN；其他状态返回 CONTACT_SUPPORT。
- 本接口只凭不可枚举的有效邀请定位单个邮箱，不接受任意 email 查询。
- 保持通用注册验证码接口统一响应；不因本次修复放开邮箱枚举。
- 预览是界面提示，注册/登录/接受时重新校验权威数据。预览后被注册的竞争情况仍由现有 409 处理。
- 缺少 nextAction 的旧后端响应不默认进入注册，显示暂不可用，避免重复陷入验证码等待。

### 3.2 接受与创建企业的并发保护

`acceptByUser()`、`AuthService.createEnterprise()` 与第三方登录邀请流程在处理已有账号时，事务内锁定同一 `users` 行，读取最新 ACTIVE 状态和 memberships 后再写入。

```sql
SELECT id FROM users WHERE id = $1 FOR UPDATE;
```

- 接受邀请仍检查邀请邮箱与登录邮箱一致。
- 这些入口统一使用 ReadCommitted；取得用户行锁后再查询归属，确保等待锁的请求能读取上一请求提交的结果。不能混用旧快照的 Serializable 读取与仅持锁、不更新用户行的流程。
- 同一人同时接受两个企业邀请，或同时开通公司和接受邀请，最多成功一条。
- 最后条件消费邀请时必须同时匹配 tokenHash、PENDING 和未过期，失败回滚成员写入。
- 事务冲突返回可理解的 409；不对 SMTP 或其他外部操作持锁。

## 4. 第一期页面

- `/join` 等认证状态恢复后分流。未登录 REGISTER 展示原注册表单，LOGIN 展示“该邮箱已有账号”及“登录并接受邀请”，保留 token 回跳。
- CONTACT_SUPPORT 展示不可用状态，不提供注册验证码或重新设密码入口。
- 登录邮箱不符：提示换账号并保留邀请；登录邮箱匹配且已有本企业身份：提供进入企业入口。
- 登录邮箱匹配但属于其他企业：展示本人当前企业，说明无需注销，链接到 `/settings/profile?invitationToken=...`。
- 个人设置保留原退出确认步骤；从邀请进入时，退出成功回到同一 `/join?token=...`，不自动接受邀请。
- 返回地址只能由 invitationToken 编码拼出固定站内 `/join`，不信任任意外部 redirect。
- 直接打开个人设置的退出操作仍回 `/no-enterprise`。
- 不持久化邀请 token 到 localStorage；仅使用当前地址和已存在的页面查询缓存。

## 5. 第二期：账号注销

### 5.1 状态与入口（按最新需求修订）

入口位于个人账号安全和无企业页面。用户为 ACTIVE 且无企业时，仅注销账号；所属企业仅剩本人且本人为 ENTERPRISE_ADMIN 时，同时关闭企业。企业还有其他成员时，须先交接并退出；平台 ADMIN、DISABLED 和 CLOSED 不能自助注销。

```text
账号 ACTIVE --登录 + 邮件证明 + 明确确认 + 事务检查--> CLOSED
企业 ACTIVE --唯一成员管理员同时注销--> CLOSED
```

发送邮件不改变账号或企业状态。打开邮件链接仅展示确认页，不执行注销；用户输入“注销账号”并提交后立即生效。无撤销期、定时注销任务、撤回入口或找回邮件入口。确认页展示待关闭企业名称、订阅终止、权限失效及业务历史保留的后果。

### 5.2 接口与证明

| 方法与路径 | 用途 |
| --- | --- |
| GET /auth/account-closure/eligibility | 已登录，返回 eligible、enterprisesToClose 和 blockers |
| POST /auth/account-closure/verification | 已登录，发送本人邮箱专用确认邮件，每用户每分钟最多一次 |
| POST /auth/account-closure | 已登录，提交 `{token, confirmation: '注销账号'}`，返回 `{status: 'CLOSED', closedAt, closedEnterprises}`，清理 refresh cookie |

保留 `/account-closure` 页面；删除 `/account-closure/cancel`、`/account-closure/recovery` 页面及对应 GET/POST 接口，登录页移除找回入口。邮件页未登录时保留 token，经登录返回。

令牌使用 32 字节随机值，只持久化 SHA256 摘要，独立目的 ACCOUNT_CLOSURE，20 分钟有效。绑定用户、当前邮箱及按 ID 排序的待关闭企业列表；企业归属变化后必须重发邮件。旧版不含企业范围的证明不能用于新流程。提交时重新检查用途、归属、邮箱、期限和阻塞项，等待企业锁后再次检查期限。完成时删除一次性凭证，无法重放。

### 5.3 阻塞条件

| 检查项 | 拒绝条件与处理 |
| --- | --- |
| 平台职责 | 平台 ADMIN 先由平台安排角色交接 |
| 企业身份 | 企业还有其他成员、本人非管理员或企业已关闭；先交接退出或联系平台 |
| 个人钱包与收益 | 个人钱包余额非零，或贡献收益 PENDING/AVAILABLE；先结清 |
| 企业资金 | 企业钱包余额/冻结额非零，或任意成员充值批次 amountCNY 与 consumedCNY 不相等；联系平台结清，不自动清零或转移 |
| 待支付订单 | 本人个人充值、本人创建或待关闭企业的市场订单，以及待关闭企业充值存在 PENDING；先支付或关闭 |
| 在途任务 | 本人或待关闭企业 TaskRun 为 RUNNING/AWAITING_CONFIRMATION，或桌面镜像未到 COMPLETED/FAILED/CANCELLED/STOPPED |
| 用量结算 | 本人或待关闭企业 GatewayExecution 为 STARTED/USAGE_PENDING/NEEDS_RECONCILIATION，或媒体预约为 RESERVED/RECONCILING |

发邮件和最终提交均重新检查，返回具体阻塞原因。企业任务及结算检查覆盖整个企业，包括已经退出的成员留下的在途工作。订阅随企业关闭终止，不自动发起退款；需结算的资产应在关闭前处理。

### 5.4 事务与并发保护

注销事务先锁 users 行，再按企业 ID 锁 enterprises 行，持锁后读取最新成员、余额与任务状态，使用 ReadCommitted。创建成员、接受邀请、邀请注册/第三方登录、API Key 创建、企业财务写入、订单履约、充值入账、订阅履约、任务创建/启动/恢复、Gateway 执行和媒体预约共享企业状态检查与行锁；涉及用户时遵循 user → enterprise 顺序。

同一事务完成：创建 COMPLETED 注销记录，企业置 CLOSED、记录 closedAt，撤销 API Key 和待处理邀请，终止 ACTIVE/PAUSED 订阅并过期 ACTIVE 赠送额度，删除本人企业成员关系，写关闭审计，匿名化用户并吊销所有认证凭证，写 ACCOUNT_CLOSED 事件。任何步骤失败整体回滚；不提前释放邮箱。

企业上下文、客户端雇佣及 Gateway/媒体授权只接受 ACTIVE 企业。财务回调中已完成订单保持幂等；已关闭企业的未履约支付拒绝自动入账，保留订单供人工对账，不丢弃付款事实。

### 5.5 邮件边界

检查通过后在事务中记录证明，释放数据库锁后调用现有 SMTP。SMTP 失败返回 503 并使本次证明失效，账号和企业仍为 ACTIVE，可重新发送。沿用现有 SMTP 配置，不新增密钥文件；控制台提供器不能冒充真实投递成功。WEB_BASE_URL 生成固定站内确认链接，生产环境必须使用 HTTPS，不记录明文 token。

### 5.6 数据保留

| 数据表/范围 | 处理 |
| --- | --- |
| users | 保留 ID/创建时间；状态 CLOSED，姓名“已注销用户”，清除头像和邮箱验证时间，角色 USER；邮箱改为 `closed+<id>.<随机值>@account.invalid`，释放原邮箱 |
| enterprises | 保留原行与业务关联，状态 CLOSED、记录关闭时间；不物理删除 |
| enterprise_members / api_keys / invitations / subscriptions | 删除本人成员关系，吊销密钥和待处理邀请，终止有效订阅及赠送额度 |
| auth_credentials / identities / tokens / one_time_tokens / oauth_transactions / devices | 删除登录凭据、绑定及已关联认证事务 |
| auth_sessions / events | 吊销会话；清除 IP、User-Agent 和历史事件 metadata，新增注销完成事件 |
| notifications | 删除个人通知 |
| account_closure_requests | 新流程只写 COMPLETED，保留操作与完成时间，不创建待撤回记录 |
| 企业审计、工作、知识、贡献、钱包、充值、订单和账务 | 保留历史，用户引用匿名主体；相同邮箱新注册不恢复旧身份、企业或权限 |

原邮箱尚未接受的邀请也撤销；重新注册需新邀请。历史业务正文中手动填写的姓名、邮箱、附件和独立存储对象不在本次自动清理范围。

### 5.7 迁移与升级

新增迁移 `20261023094000_immediate_account_enterprise_closure`，增加 EnterpriseStatus（ACTIVE/CLOSED）、enterprises.status 默认 ACTIVE 和 closedAt。保留上一期状态枚举及注销记录字段以兼容历史数据，不改写旧迁移。

升级前查询旧 PREPARING/PENDING 申请和 CLOSURE_PENDING 用户。有遗留时先通过旧版流程处理并复核，再切换新版本；不能直接将旧申请转换为立即注销，也不能静默恢复账号。本地检查两者均为零，未做数据清理。

因本地历史迁移 `20260924081416_add_rpa_contribution_versions` 校验不一致，migrate dev 会要求重建库；本次使用 Prisma migrate diff 生成增量，再 migrate deploy 和 db:generate，未重置数据库。Review 时新增工具生成的迁移 `20261023121000_user_updated_at_default`，记录已有 `User.updatedAt` 默认值变更，保持 schema 与迁移一致，未修改已应用迁移。部署其他环境时需分别执行迁移和上述遗留检查。

## 6. 实施与验证清单

### Task 1：共享契约和有效邀请分流

- 修改 `backend/src/shared/index.ts`、`backend/src/modules/enterprise/invitation.service.ts`、`web/src/lib/types.ts`。
- 先扩充 `invitation.service.spec.ts`：REGISTER/LOGIN/CONTACT_SUPPORT、无效 token 不查 User、无原企业泄漏。
- 验证：`pnpm --dir backend exec jest --runInBand --runTestsByPath src/modules/enterprise/invitation.service.spec.ts`。

### Task 2：登录接受与退出回跳

- 修改 `web/src/app/(auth)/join/page.tsx`、`web/src/features/auth/use-auth.ts`、个人设置页；抽取确有复用的退出企业组件到 auth feature。
- 先补 `join/page.spec.tsx` 与 hook/组件回归测试，验证已有账号没有验证码输入，token 正确编码保留，退出成功回跳、失败不清身份，直接退出维持原行为。
- 验证：对应 Vitest 文件；前端 TypeScript。

### Task 3：事务内身份与归属复核

- 修改 `invitation.service.ts`、`auth.service.ts` 的创建企业写事务，以及 `oauth.service.ts` 的已有账号邀请写事务。
- 测试事务内重新出现归属、非 ACTIVE、邀请被轮换或消费时回滚/拒绝。
- 验证：邀请与 auth 相关 Jest，后端 TypeScript。

### Task 4：集成检查与交付

- 对改动文件 ESLint、`git diff --check`、前后端 build/typecheck，按风险运行相关测试套件。
- 尝试实际页面验证。浏览器访问若被权限策略拒绝，不绕过，不将组件测试当作真实截图验证。
- 实际注销真实账号及企业数据处置不作为开发冒烟操作。第二期需独立测试数据和明确的验收场景。
- 完成后记录本期状态与未执行项；不自动提交、推送、部署或修改用户已有 schema 改动。

## 7. 进度

- 第一期：Task 1–4 实现及自动化验证完成；实际浏览器页面验收受访问策略限制，待人工验证。
- 第一期提交：`36b7af3 fix(auth): route existing invitees to login and preserve invitation return`。
- 第二期原版：已提交 `f61f0ff`，下方旧版验证记录仅作为历史，不代表当前撤回策略。
- 本次修订：按“唯一成员管理员可同时关闭企业、邮件确认后立即生效、不提供撤回”实现，迁移、自动化验证及 Review 完成。实际浏览器及独立测试账号验收待执行。

### 验证记录（2026-10-23）

- 前端邀请页、注册页、认证 hooks、退出企业组件：5 个测试文件、42 项通过。
- 后端邀请、创建企业与第三方登录核心回归：3 个测试文件、80 项通过。
- 后端完整 Jest：229 个测试套件、5,107 项通过；9 个套件、111 项按现有配置跳过。
- 前端完整 Vitest：105 个测试文件、1,101 项通过。
- 前后端 TypeScript 检查、前后端生产构建、`git diff --check` 均通过。
- 改动文件 ESLint 无错误；个人设置页原有 `profileForm.watch()` 有 1 条 React Compiler 兼容性警告，OAuth 服务原有 `OAuthProviderId` 有 1 条未使用导入警告。
- 本地后端 `/api/health` 返回 `ok`，数据库和 Redis 已连接。
- 事务保护测试使用 mock Prisma，覆盖行锁顺序、ReadCommitted 选项、锁后状态/归属变化与条件消费失败；未运行真实数据库的并发压力测试。
- 实际浏览器页面/截图未验证：浏览器安全策略拒绝访问本地站点，未绕过；组件测试不等于实际页面验收。
- 上述为第一期验证记录；第一期未新增迁移，后续按用户要求已提交，未推送 Git。

### 第二期旧版验证记录（2026-10-23，已被本次修订替代）

- 注销服务、HTTP controller 与邮件服务定向验证：3 个套件、46 项通过，覆盖令牌期限/重放/绑定、SMTP 失败、阻塞条件复核、GET 只读、撤回竞争、匿名化幂等、失败回滚与邮件找回。
- 前端新增注销流程与 hooks：14 项通过；现有认证/邀请相关回归 46 项通过。
- 前端完整 Vitest：107 个测试文件、1,115 项通过。
- 后端最终完整 Jest 运行：230 个套件、5,193 项通过，9 个套件、111 项按现有配置跳过；Gateway HTTP 的一项用例发生 `socket hang up`。单独重跑该套件 51 项全部通过，未修改该套件实现，不将这次全量运行记为一次性全绿。
- Gateway 执行、媒体账单及视频 HTTP/账单回归：4 个套件、105 项通过；财务、支付、任务和贡献收益定向回归：7 个套件、350 项通过。
- 前后端 TypeScript 检查、生产构建及 `git diff --check` 通过。改动文件 ESLint 无错误，后端 21 条警告、前端 1 条 React Hook Form/React Compiler 兼容性警告，未扩大范围清理。
- Prisma `migrate status`：93 个迁移，数据库已是最新；`db:generate` 已执行。本地后端 `/api/health` 返回 `ok`，Gateway 为 `ready`。
- 实际浏览器截图验证仍受 localhost 访问策略限制；未对真实用户发起注销或执行最终清理，未运行真实数据库并发压力测试。

### 立即注销与企业关闭验证记录（2026-10-23）

- 后端完整 Jest：234 个套件、5,214 项通过；9 个套件、111 项按现有配置跳过。
- 前端完整 Vitest：107 个测试文件、1,112 项通过。
- 完整检查后补齐企业成员钱包余额阻塞、持锁等待后的证明期限复核及订阅赠送额度失效；注销服务、HTTP controller 和邮件服务复验共 3 个套件、46 项通过。
- 前后端 TypeScript 和生产构建通过；最后补充代码后后端 TypeScript、构建及上述定向测试再次通过。
- 改动文件 ESLint 无错误，后端 6 条和前端 1 条现有警告；`git diff --check` 通过。
- 本地新增迁移已应用并运行 db:generate；Review 补齐默认值迁移后共 95 个迁移，Prisma migrate diff 确认数据库与 schema 无差异。旧 PREPARING/PENDING 申请及 CLOSURE_PENDING 用户均为零。
- 本地 `/api/health` 返回 ok、Gateway ready；`/account-closure` HTTP 200。旧撤回/找回 HTTP 接口由回归测试验证返回 404。
- 未对真实账号执行不可逆注销，未运行真实数据库并发压力测试。浏览器访问策略仍限制实际页面截图验证，不将组件测试和 HTTP 检查视为视觉验收。
- Review 修正重新注册需新邀请的前端文案和旧 Swagger 描述，并为已有 User.updatedAt 默认值修改补齐工具生成的独立迁移；修正后后端定向测试 46 项、前端注销流程及 hooks 测试 11 项再次通过。
- 已关闭企业残留成员关系按异常数据阻塞并提示平台处理；正常关闭在同一事务删除本人成员关系。企业锁校验部分沿用各模块的原有写法，统一抽取属于后续非阻断维护项。
- 未新增依赖、修改 SMTP 密钥、重置数据库或推送 Git。
