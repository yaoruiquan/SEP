# 邀请分流与账号注销开发文档

**Goal:** 已有账号可登录接受邀请，换企业通过退出企业完成；账号注销独立提供完整生命周期。

**Architecture:** 保留 User 与 EnterpriseMember 的分离，以有效邀请为上下文决定注册或登录，不开放任意邮箱注册状态查询。第一期修复邀请入口和退出后的返回路径；第二期实现注销前检查、身份确认、撤销期及最终匿名化，不将注销作为入职条件。

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
- 唯一管理员先安排其他管理员。账号注销也不能绕过此约束。
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

### 5.1 状态与入口

入口位于个人账号安全，且无企业账号也应能进入。将“退出登录”“退出企业”“注销账号”作为不同操作，展示各自影响。

```text
ACTIVE --身份验证与前置检查通过--> CLOSURE_PENDING
CLOSURE_PENDING --本人撤销--> ACTIVE
CLOSURE_PENDING --撤销期结束且再次检查通过--> CLOSED
DISABLED --平台处置--> DISABLED
```

- 撤销期默认 7 天，环境变量 `ACCOUNT_CLOSURE_GRACE_DAYS` 支持 1–30 的整数，无效值回退 7 天。注销请求创建时返回明确生效时间。
- 待生效期间保留邮箱唯一性；禁止创建企业、接受邀请和新增收费行为。
- 禁用账号不能通过注销自助解除平台限制。
- 状态、时间、执行结果持久化；不可仅靠 Redis TTL 或前端倒计时。

### 5.2 前置检查与身份确认

- 所有企业归属必须先退出；唯一管理员先移交管理职责。注销不得自动删除企业或将企业资产带走。
- 个人余额、待支付/退款/对账事项、在途任务和个人贡献收益等逐项检查，返回可行动的阻塞原因；不静默清零。
- 注销需要有效登录会话和本人邮箱的专用确认链接，兼容密码账号及只有第三方登录的账号。确认令牌使用独立的 `ACCOUNT_CLOSURE` 目的，不复用注册验证码。
- 提交前再次展示后果并要求输入“注销账号”；令牌使用 32 字节随机值，只存 SHA256 摘要，绑定用户和签发时邮箱，20 分钟有效，限流且一次性使用。

### 5.3 撤销和最终执行

- 申请后撤销普通 Web/Desktop 会话；发一封通知邮件，提供专用、限时且只允许撤销注销的恢复凭证。
- 撤销不能通过失效的普通登录会话完成；提供独立受限入口，验证凭证且不隐式登录。邮件链接的 GET 不执行撤销，需确认后 POST。
- 每个请求有唯一 ID；撤销凭证绑定该请求，旧请求的链接不能撤销后续申请。
- 最终执行由幂等定时任务处理，事务锁定用户和注销请求；与撤销竞争时只能一个成功。任务失败记录原因、可重试，不提前释放邮箱。
- 最终注销撤销会话、refresh token、设备凭证、密码重置/换绑凭证和未完成 OAuth 事务，删除登录凭据及第三方身份绑定。
- 保留原 User ID 作为历史业务关联的匿名主体，清除个人展示字段，email 换成唯一不可投递的内部占位值后再释放原邮箱。
- 失效原账号相关待处理邀请；旧账户标识/权限不会因相同邮箱重新注册而恢复。
- 企业侧审计、账务和工作记录保留；个人记录的匿名化/清理范围逐表定义，不能依赖 `User.delete()` 的级联结果。
- 钱包、支付回调和认证入口全部复核生命周期状态，避免注销检查后又新增业务的竞争窗口。

### 5.4 接口与迁移

新增 `AccountClosureService`、独立 controller/shared DTO、注销页面与测试：

| 方法与路径 | 用途 |
| --- | --- |
| GET /auth/account-closure/eligibility | 本人查看前置检查结果 |
| POST /auth/account-closure/verification | 已登录，发送本人邮箱专用确认链接 |
| POST /auth/account-closure | 已登录，提交 `{token, confirmation: '注销账号'}`，返回生效时间并清理 refresh cookie |
| GET /auth/account-closure/cancel?token=... | 公开，只读预览撤回截止时间，不改变状态 |
| POST /auth/account-closure/cancel | 用专用凭证撤销申请 |
| POST /auth/account-closure/recovery | 公开，提交 `{email}` 重发撤回邮件，统一响应 |

页面：`/account-closure`、`/account-closure/cancel`、`/account-closure/recovery`。安全设置和无企业页面提供申请入口，登录页提供找回撤回邮件入口。邮件确认页未登录时保留 token，经登录后返回；撤回操作不需要普通会话，也不会自动登录。

迁移 `20261023070000_account_closure_lifecycle` 新增 `account_closure_requests`、生命周期枚举和索引。`activeUserId` 唯一约束保证每人同时最多一份准备中/待生效申请；`cancellationTokenHash` 唯一且绑定单次申请，取消或完成后清空。记录计划执行时间、完成/取消时间、尝试次数及安全错误分类。

本地 `prisma migrate dev --create-only` 因历史迁移 `20260924081416_add_rpa_contribution_versions` 校验不一致要求重建数据库，未执行重建。改用 Prisma `migrate diff` 生成增量，仅移除与本功能无关的 `users.updatedAt` 默认值变更，再用 `prisma migrate deploy` 成功应用，并执行 `pnpm db:generate`。历史迁移未改动，其校验差异仍需单独维护；用户已有 schema 默认值修改原样保留。

### 5.5 邮件安全与事务边界

申请分两步激活：持用户行锁检查状态、证明和阻塞项，创建 `PREPARING` 预约；释放锁后发送撤回邮件；投递成功后重新持锁复核条件，再原子切换申请为 `PENDING`、用户为 `CLOSURE_PENDING`，消费证明并撤销全部会话。SMTP 失败则取消预约，用户维持 ACTIVE，确认链接在有效期内仍可重试。邮件投递与数据库写入不能成为单个事务；若投递后激活失败，用户仍保持 ACTIVE，邮件中的撤回链接不会产生状态变更。

注销邮件必须使用可用的 SMTP；控制台邮件提供器不能冒充投递成功。沿用运营配置中心/环境变量中的现有 SMTP 配置，不新增密钥配置文件。`WEB_BASE_URL` 用于生成固定站内链接，生产环境必须是 HTTPS。邮件服务错误返回 503，不记录明文凭证。

公开找回接口按邮箱每分钟 1 次、IP 每 10 分钟 5 次限流，对无账号、无待撤回申请和投递失败均返回统一提示。新邮件投递成功后才条件轮换撤回凭证；发送失败保留旧链接。轮换与取消/最终执行竞争时不恢复已结束的申请。

撤销会话时只吊销 session/token，不在申请阶段永久吊销设备指纹。撤回后用户可从原桌面设备重新登录；原会话、旧 refresh token 仍无效。最终注销时删除设备行。

### 5.6 前置阻塞项

| 检查项 | 拒绝条件与处理 |
| --- | --- |
| 平台职责 | 平台 ADMIN 先由平台安排角色交接 |
| 企业身份 | 任意企业成员关系存在；先退出，唯一管理员先移交 |
| 个人钱包 | 余额不为零；先结清或联系平台处理 |
| 订单 | 本人个人充值或本人创建的企业订单为 PENDING；先支付或关闭 |
| 贡献收益 | 收益事件为 PENDING/AVAILABLE；先结算或人工处理 |
| 运行任务 | TaskRun 为 RUNNING/AWAITING_CONFIRMATION；桌面镜像未到 COMPLETED/FAILED/CANCELLED/STOPPED |
| 用量结算 | GatewayExecution 为 STARTED/USAGE_PENDING/NEEDS_RECONCILIATION，或媒体计费预约为 RESERVED/RECONCILING |

申请、激活和最终执行都重新检查。认证、创建企业/接受邀请、桌面写入、个人充值/奖励/消费和任务创建/启动/更新使用 ACTIVE 状态约束，关键写入与注销使用同一用户行锁。Gateway 执行创建、媒体资金预约（含幂等重试）也在事务内锁定用户并复核 ACTIVE；既有媒体预约的结算/释放允许 ACTIVE/CLOSURE_PENDING 收口，但拒绝 CLOSED/DISABLED。已付款重复回调保持幂等；非 ACTIVE 账号的未履约充值不自动入账，保留待处理订单并报人工对账错误，不静默丢弃付款。

平台认证用户列表和详情页显示 CLOSURE_PENDING/CLOSED，支持状态筛选；注销中的账号不能由普通启用/禁用操作恢复，界面禁用相关认证写操作，后端继续执行生命周期校验。

### 5.7 最终执行与数据范围

定时任务每 5 分钟处理至多 100 个到期请求，先清理超过 30 分钟的 `PREPARING` 预约。最终执行与撤回共用用户行锁，复核 PENDING/截止时间后在同一事务完成。失败回滚所有清理，保留原邮箱，增加 attempts 并记录 `ELIGIBILITY_BLOCKED` 或 `FINALIZATION_FAILED`，下轮重试。

| 数据表/范围 | 最终处理 |
| --- | --- |
| users | 保留 ID 和创建时间；状态 CLOSED，姓名“已注销用户”，清除头像/邮箱验证时间，角色 USER；邮箱换成 `closed+<id>.<随机值>@account.invalid` |
| auth_credentials、auth_identities | 删除密码凭据与第三方身份绑定 |
| auth_tokens、auth_one_time_tokens、auth_oauth_transactions、devices | 删除登录/重置/换绑/注销证明、已关联 OAuth 事务及设备凭据 |
| auth_sessions | 保留已吊销记录，清除 IP 和 User-Agent |
| auth_events | 保留操作类型/时间/主体，清除 IP、User-Agent 与历史 metadata；新增注销完成事件 |
| notifications | 删除个人通知 |
| enterprise_invitations | 将原邮箱仍 PENDING 的邀请撤销，重新注册须新邀请 |
| account_closure_requests | 保留生命周期和执行记录，清除有效撤回摘要和 activeUserId |
| 企业成员审计、会话/任务/知识/贡献、钱包/充值/订单/账务记录 | 保留业务关联及历史内容，用户引用指向匿名主体；不级联删除，不转移到相同邮箱新账号 |

本功能不承诺擦除历史业务正文中用户曾手动填写的姓名、邮箱或附件内容，也不自动删除独立文件存储对象；这些属于企业数据治理范围。保留范围须在上线验收时由产品和运营确认，页面明确告知企业账务与历史工作记录保留。

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
- 第二期：实现、数据库迁移及自动化集成验证完成；独立于邀请入职流程。按用户后续要求提交代码，实际浏览器及独立测试账号验收由用户执行。

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

### 第二期验证记录（2026-10-23）

- 注销服务、HTTP controller 与邮件服务定向验证：3 个套件、46 项通过，覆盖令牌期限/重放/绑定、SMTP 失败、阻塞条件复核、GET 只读、撤回竞争、匿名化幂等、失败回滚与邮件找回。
- 前端新增注销流程与 hooks：14 项通过；现有认证/邀请相关回归 46 项通过。
- 前端完整 Vitest：107 个测试文件、1,115 项通过。
- 后端最终完整 Jest 运行：230 个套件、5,193 项通过，9 个套件、111 项按现有配置跳过；Gateway HTTP 的一项用例发生 `socket hang up`。单独重跑该套件 51 项全部通过，未修改该套件实现，不将这次全量运行记为一次性全绿。
- Gateway 执行、媒体账单及视频 HTTP/账单回归：4 个套件、105 项通过；财务、支付、任务和贡献收益定向回归：7 个套件、350 项通过。
- 前后端 TypeScript 检查、生产构建及 `git diff --check` 通过。改动文件 ESLint 无错误，后端 21 条警告、前端 1 条 React Hook Form/React Compiler 兼容性警告，未扩大范围清理。
- Prisma `migrate status`：93 个迁移，数据库已是最新；`db:generate` 已执行。本地后端 `/api/health` 返回 `ok`，Gateway 为 `ready`。
- 实际浏览器截图验证仍受 localhost 访问策略限制；未对真实用户发起注销或执行最终清理，未运行真实数据库并发压力测试。
