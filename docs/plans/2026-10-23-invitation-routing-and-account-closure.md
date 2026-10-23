# 邀请分流与账号注销开发文档

**Goal:** 已有账号可登录接受邀请，换企业通过退出企业完成；账号注销独立提供完整生命周期。

**Architecture:** 保留 User 与 EnterpriseMember 的分离，以有效邀请为上下文决定注册或登录，不开放任意邮箱注册状态查询。第一期修复邀请入口和退出后的返回路径；第二期实现注销前检查、身份确认、撤销期及最终匿名化，不将注销作为入职条件。

**Tech Stack:** NestJS、Prisma/PostgreSQL、Next.js App Router、TanStack Query、共享 Zod、Jest/Vitest。

**执行方式:** 本会话按任务实施、验证，不自动提交或推送。

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

## 5. 第二期：账号注销（独立后续模块）

### 5.1 状态与入口

入口位于个人账号安全，且无企业账号也应能进入。将“退出登录”“退出企业”“注销账号”作为不同操作，展示各自影响。

```text
ACTIVE --身份验证与前置检查通过--> CLOSURE_PENDING
CLOSURE_PENDING --本人撤销--> ACTIVE
CLOSURE_PENDING --撤销期结束且再次检查通过--> CLOSED
DISABLED --平台处置--> DISABLED
```

- 建议撤销期为 7 天，具体期限作为产品配置。注销请求创建时返回明确生效时间。
- 待生效期间保留邮箱唯一性；禁止创建企业、接受邀请和新增收费行为。
- 禁用账号不能通过注销自助解除平台限制。
- 状态、时间、执行结果持久化；不可仅靠 Redis TTL 或前端倒计时。

### 5.2 前置检查与身份确认

- 所有企业归属必须先退出；唯一管理员先移交管理职责。注销不得自动删除企业或将企业资产带走。
- 个人余额、待支付/退款/对账事项、在途任务和个人贡献收益等逐项检查，返回可行动的阻塞原因；不静默清零。
- 注销需近期重新认证，支持密码账号及只有第三方登录的账号。注销验证码与注册验证码分目的存储，不复用通用注册验证码发送接口。
- 提交前再次展示后果并由用户明确确认；身份验证令牌只存摘要，限时、限次、一次性使用。

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

### 5.4 计划接口与迁移

后续新增 `AccountClosureService`、独立 controller/shared DTO、注销页面与测试，建议接口：

| 方法与路径 | 用途 |
| --- | --- |
| GET /auth/account-closure/eligibility | 本人查看前置检查结果 |
| POST /auth/account-closure/verification | 身份再认证或专用邮件验证 |
| POST /auth/account-closure | 确认提交申请，返回生效时间 |
| POST /auth/account-closure/cancel | 用专用凭证撤销申请 |

迁移将新增注销请求表、生命周期状态与必要索引；使用 Prisma 工具生成，不编辑历史迁移。该迁移只在第二期执行，第一期不修改 schema。

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
- 第二期：完成设计，未实现、未迁移；独立于本期邀请修复。

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
- 本期不新增迁移，不修改既有 schema 改动，不提交或推送 Git。
