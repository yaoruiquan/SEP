# 通知限流根因修复与全局策略审计

日期：2026-10-27。范围：本地源码、实际安装依赖、真实守卫 HTTP 回归。没有连接、修改或部署生产环境，没有提交或推送 Git。

本文更新并取代同日仅在通知控制器跳过规则的初步方案。收到“彻底修复”的要求后，修复范围扩展为全局具名策略、可信身份计数、基础中间件及安全代理配置入口。

## 1. 已证实的根因与边界

1. 实际安装 `@nestjs/throttler` **6.7.0**。原版全局 `ThrottlerGuard` 遍历所有具名规则；`auth` / `chat` 只是名称，不会自动匹配路径或业务类别。`@Throttle({ auth: ... })` 只覆盖该规则参数，不会停用其他规则。
2. 修复前，通知列表与未读数在真实守卫 HTTP 测试中均复现第 11 次请求返回 429、`Retry-After-Auth: 60`。跳过 auth 后还会受无关 chat 60/60s 限制，因此只提高通知额度或只处理一个规则都不完整。
3. 原计数键由依赖生成：`SHA256(controllerClassName + '-' + handlerName + '-' + ruleName + '-' + normalizedReqIp)`。不含用户、JWT、HTTP 动词或查询参数；GET/HEAD 同 handler 共桶，列表与未读数各自独立。**不是全站共享 10 次**。
4. 多个用户若被识别为同一代理 IP，会共享同 handler 的原限额。本地 HTTP 已复现并验证修复。原 `main.ts` 没有启用 Express trust proxy；仓库部署方案是 REST 经 Caddy → Next rewrite → Nest，因此存在代理 IP 聚合的条件，但没有线上观测证明实际部署所有请求已合并。
5. 另一个真实复现的问题：基础 `basicRateLimitMiddleware` 对 `/api/auth/me` 等路径按 IP 聚合 120/60s，修复全局守卫后仍可能把两个正常用户合并阻断。它原先也固定返回 `Retry-After: 60`，而不是窗口剩余时间。这两项一并修复。基础中间件不覆盖通知路径，不把它误报为通知初始 429 的来源。

依赖证据：`backend/node_modules/@nestjs/throttler/dist/throttler.guard.js` 的 `canActivate`、`getTracker`、`generateKey`；`dist/ip.js`；`dist/throttler.service.js`。IPv4-mapped IPv6 会规范化，匿名 IPv6 默认按 /64 聚合。

线上构建/依赖是否与本地一致、生产是否误设 E2E_TEST、实例数量、实际 peer IP/转发链、Electron 错误映射仍需部署验收；不能把本地结论写成已在线上修复。

## 2. 规则生效范围

### 全局策略修复

`security.module.ts` 保留真实 `ThrottlerGuard`，不关闭全局保护，不调高既有生产额度。`rate-limit-policy.ts` 使 auth/chat **显式选择才启用**：方法或控制器声明该名称的 `@Throttle`，或 `@SkipThrottle({ name: false })`；既有 `SkipThrottle(true)` 继续由原守卫优先处理。新普通控制器无需记得补排除装饰器。

| 类别 | 生效规则与计数身份 | 范围 |
| --- | --- | --- |
| 普通业务 | default 100/60s；经签名验证的用户，匿名/非法凭证回退规范化 IP | 通知、profile、会话查询、CRUD、观察/历史等；既有 default 特定覆盖值保留 |
| 认证/敏感凭证操作 | default + 显式 auth；auth 仍按 IP，既有 3/5/10 次/60s | 登录、验证码、注册、密码重置/修改、邮箱确认/修改、OAuth、刷新凭证、注销验证/提交 |
| 对话/模型触发 | default + chat 60/60s；经验证的用户 | sendMessage、preview、run、retry、resume 五个 handler |
| 模型 gateway | 既有专属 GatewayRateLimitGuard 与 employment 认证 | 原有跳过全局三规则不变，不能称为无保护 |
| 媒体 gateway | 既有 default 与专属认证/失败保护 | 保留原有 auth/chat 排除及自身安全机制 |

`default`/`chat` 身份通过 HS256 签名和到期校验，使用 ACCESS_JWT_SECRET（兼容 JWT_SECRET），只接受带 exp、非空 sub 的 access/client-employment。不会信任 req.user、未验证解码、X-User-Id 或任意 XFF。更换 token/session、分页查询、伪造转发头不能重置同一用户额度。它只选预算，不代替路由 JWT/用户存在性/会话/权限校验。

基础中间件保留原路径集合与 120/60s，实际 bootstrap 接入同一可信身份选择器；合法用户互不消耗普通业务额度，匿名回退 IP。auth 具名桶仍按 IP，所以带不同合法 bearer token 也不能绕过登录 10 次限制。其 Retry-After 改为剩余窗口秒数向上取整，至少 1。

计数仍含控制器、handler、规则名称；没有改成全站用户总额。存储仍为进程内，未新增 Redis 依赖或改变分布式语义；多实例之间不共享该计数。

### 通知六个接口

类级显式 `@SkipThrottle({ auth: true, chat: true })` 保留作为通知契约，六个 handler 只用 default 100/60s：

| HTTP 方法与路径（含 `/api`） | handler |
| --- | --- |
| GET /notifications | list |
| GET /notifications/unread-count | unreadCount |
| POST /notifications/:id/read | markAsRead |
| POST /notifications/read-all | markAllAsRead |
| DELETE /notifications/:id | delete |
| DELETE /notifications/clear-read | clearRead |

通知 JwtAuthGuard、service 的 userId 筛选、CSRF 和权限实现没有变更。

### 敏感端点显式登记

策略测试锁定 24 个认证 handler：

- AuthController：requestRegistrationEmailCode、register、verifyInvitation、registerByInvitation、login、requestPasswordReset、resetPassword、changePassword、requestEmailVerification、confirmEmailVerification、requestEmailChange、confirmEmailChange、oauthRegisterStart、oauthInvitationStart、oauthStart、oauthLinkStart、oauthCallback、unlinkOAuth、refresh。
- AccountClosureController：verification（3）、request（5）；eligibility 属普通读取。
- ClientController：login、refreshAccessToken、refreshInstanceToken（均 10）。

既有 auth 覆盖值原样保留；此前依赖隐式 auth10 的敏感方法补齐显式声明，避免全局策略纠正后失去保护。AuthController 的 me、sessions、identities、providers、auth events、logout/revoke 等不再受登录尝试额度或 chat 额度误限。

模型触发显式登记：ConversationController.sendMessage；TaskPlanningController.preview；TaskExecutionController.run/retry/resume。会话列表、消息历史、执行详情、stop/pause、SSE/交付物读取使用普通业务规则。

## 3. 全局误用范围审计

修复前的静态 AST 审计发现 50 个控制器类完全没有 Throttle/SkipThrottle：47 个普通业务/管理类，3 个对话/编排/执行类。以下不是逐个端点的生产复现清单；现在通过全局 opt-in 策略统一消除无关 auth/chat，无需给每个普通控制器补装饰器。

普通业务/管理类完整清单（路径相对 `backend/src/modules/`）：

| 文件 | 控制器类 |
| --- | --- |
| admin/admin-upload.controller.ts | AdminUploadController |
| admin/admin.controller.ts | AdminController |
| announcement/announcement.controller.ts | AnnouncementController |
| audit/audit.controller.ts | AuditController |
| capability/capability.controller.ts | CapabilityController |
| capability-contribution/capability-contribution-admin.controller.ts | CapabilityContributionAdminController、CapabilityReviewAdminController |
| capability-contribution/capability-contribution.controller.ts | CapabilityContributionController |
| capability-insight/capability-insight.controller.ts | CapabilityInsightController |
| client/client-skill-artifact.controller.ts | ClientSkillArtifactController |
| compute/compute.controller.ts | ComputeController |
| compute-credit/compute-credit.controller.ts | ComputeCreditController |
| compute-quota/compute-quota.controller.ts | ComputeQuotaController |
| cost-analytics/cost-analytics.controller.ts | CostAnalyticsController |
| dashboard/dashboard.controller.ts | DashboardController |
| digital-employee/digital-employee.controller.ts | DigitalEmployeeController |
| digital-employee/market.controller.ts | MarketController |
| digital-employee/package.controller.ts | PackageController |
| enterprise/enterprise-logo.controller.ts | EnterpriseLogoController |
| enterprise/enterprise.controller.ts | EnterpriseController |
| enterprise/organization.controller.ts | OrganizationController |
| enterprise-model-config/department-model-policy.controller.ts | DepartmentModelPolicyController |
| enterprise-model-config/enterprise-model-config.controller.ts | EnterpriseModelConfigController |
| enterprise-settings/api-key.controller.ts | ApiKeyController |
| enterprise-settings/custom-role.controller.ts | CustomRoleController |
| enterprise-settings/enterprise-settings.controller.ts | EnterpriseSettingsController |
| knowledge/knowledge-monitoring.controller.ts | KnowledgeMonitoringController |
| knowledge/knowledge.controller.ts | KnowledgeController |
| knowledge/search.controller.ts | SearchController |
| knowledge/text-chunk.controller.ts | TextChunkController |
| media-config/media-config.controller.ts | MediaConfigController |
| media-config/media-video-config.controller.ts | MediaVideoConfigController |
| model/model.controller.ts | ModelController |
| monitoring/monitoring.controller.ts | MonitoringController |
| payment/order.controller.ts | OrderController |
| payment/payment.controller.ts | PaymentController |
| payment/personal-recharge.controller.ts | PersonalRechargeController |
| personal-wallet/personal-wallet.controller.ts | PersonalWalletController |
| setting/setting.controller.ts | SettingController |
| skill-version/skill-version.controller.ts | AdminSkillVersionController |
| subscription/subscription.controller.ts | SubscriptionController |
| subscription-request/subscription-request.controller.ts | SubscriptionRequestController |
| task/task.controller.ts | TaskController |
| upload/upload.controller.ts | UploadController |
| users/user.controller.ts | UserController、UserAvatarController |
| wallet/wallet.controller.ts | WalletController |


混合控制器：ClientController 普通 profile、余额、订阅、runtime 与员工请求；DocumentController 的上传、版本、预览、下载、重处理、删除；EnterpriseSkillVersionController 的提交/审核/编辑/发布/选择/使用查询等，原先没有明确跳过的方法同样会隐式受 auth/chat 限制。现在未选择的规则自然不生效，既有读取 default 覆盖与模块专属校验原样保留。`health/health.controller.ts` 的 `/api/health` 同样不再误受 auth/chat，仍保留 default；main.ts 的 `/health` 是另一条直接挂载路径。

本次必须并已修复：全局误用、通知六接口、敏感端点显式保留、模型触发范围、同代理用户预算互扰、基础中间件等待时间，以及安全代理配置入口。

后续建议而非本次追加调整：对支付/API key/上传/管理等模块制定新的更细敏感动作额度；评估健康探针专属策略；如业务要求跨实例精确全局配额，再设计共享 storage。这些没有新增额度、依赖或模块改造。已有权限、资源/失败保护不会因本次取消无关 auth/chat 而取消。

## 4. 代理/IP：默认安全，显式启用

新增 `common/trusted-proxy.ts`，默认 `TRUSTED_PROXY_CIDRS` 为空，保持 trust proxy=false。只允许经过部署核实的明确 IP/CIDR，拒绝 true、跳数、loopback 等别名、/0 与非法前缀。Express 只沿显式可信 peer 逐跳解析，在第一个不可信节点停止，不取任意 XFF 最左项。

三个 `.env.example` 及生产 compose 仅增加空值配置入口；没有改实际 .env、Caddy、生产网络或在线进程。通知等合法 access 用户即使不启用代理信任也已经各自计数。匿名/认证 IP 桶仍需实际代理链正确解析；不能为了上线而把整个共享 Docker 网络或任意转发头设为可信。

部署启用前核实 Caddy → Next → Nest 的实际 peer、转发头生成/追加方式、直连入口限制；如果其他容器可连接后端，确认它们不能伪造受信链。没有线上证据时不提供臆造 CIDR，不自动启用。

## 5. 429、鉴权与客户端

- 真实 HTTP 测试验证状态保持 429，沿用现有 `statusCode/message/requestId/timestamp/path` 业务错误结构，不返回内部 key、tracker、身份或 stack。没有把限流变成 401。
- 现有 HttpExceptionFilter 负责把 Retry-After-Auth/Chat 转为标准 Retry-After，本次不重写过滤器。通知不再出现 auth/chat 限流头，超额只返回 default 等待时间。
- throttler 6.7.0 未单配 blockDuration 时等于 ttl，阻断从首次超额开始；HTTP 断言 60 → 48 → 1 → 恢复，不能用第一条请求开始后的窗口剩余时间替代该阻断语义。基础中间件则按其既有固定窗口计算，二者不能混为一谈。
- 仍要求 JWT，未知/过期/错误类型凭证拒绝；查询与单条/批量操作按用户隔离。限流前的预算身份验证不授予访问权。
- 不需要客户端协议或版本配合即可修复服务端行为。仓库 Web 仅对 401 刷新/清认证，429 保持 ApiError(429)。仓库没有对应 Electron 主进程源码，不能替其确认状态映射；若它把 429 显示为登录失效，应修正客户端映射，并可按 Retry-After 退避。

## 6. 修改文件

生产实现：

- `backend/src/modules/security/security.module.ts`、新增 `rate-limit-policy.ts`：全局具名规则范围和可信业务身份。
- `backend/src/modules/notifications/notifications.controller.ts`：显式排除 auth/chat、Swagger 429。
- `backend/src/modules/auth/auth.controller.ts`、`client/client.controller.ts`：保留敏感方法 auth。
- `backend/src/modules/conversation/conversation.controller.ts`、`task-planning/task-planning.controller.ts`、`task-execution/task-execution.controller.ts`：明确五个模型触发 handler 的 chat。
- `backend/src/common/middleware/basic-rate-limit.middleware.ts`、`backend/src/main.ts`：基础中间件可信身份与准确等待时间、接入代理配置。
- 新增 `backend/src/common/trusted-proxy.ts`；`.env.example`、`backend/.env.example`、`deploy/production/.env.example`、`deploy/production/docker-compose.yml`：安全可选代理入口。

测试：新增 notifications-throttling.http.spec.ts、rate-limit-policy.spec.ts、trusted-proxy.http.spec.ts；更新 basic-rate-limit.middleware.spec.ts、gateway-rate-limit.http.spec.ts。原有 gateway 测试夹具从“普通接口隐式 auth10”改为分别明确测试普通100、登录10、聊天60，保留 gateway 自身覆盖。

无新增依赖、数据库改动、生产变更。工作区并行出现的 web 营销下载菜单/发布配置改动未触碰。

## 7. 验证证据

HTTP 使用真实 SecurityModule、原版 ThrottlerGuard/storage、JWT guard/strategy、路由、异常过滤器与基础中间件；只 mock Prisma 和无关业务依赖。通知服务真实执行。只控制 Date.now，HTTP socket/定时器保持真实。测试显式在加载全局规则时关闭 E2E 放宽，所以即使外层 E2E_TEST=1 仍验证生产限额。

- 通知及全局策略 HTTP **25/25**：六接口各100成功/101拒绝、列表和未读数超过10次、Retry-After 递减/恢复、同代理两用户独立、同用户换 token 不重置、普通 profile/auth-me、不绕过桌面登录IP限流、真实 planner60/61、鉴权和读写隔离、Web 登录/验证码/忘记/重置密码。
- 策略 **66/66**：24敏感/5模型 handler、普通业务分类、显式 opt-in、真实 JWT 验签及无效身份回退IP。对当前依赖元数据约定有回归覆盖，升级 throttler 时必须保留这些测试。
- 代理 HTTP **14/14**；基础中间件 **9/9**；连同 gateway 和 AppModule DI，定向 **6 suites / 128 tests** 全通过。
- 单独 E2E_TEST=1 的通知 HTTP **25/25** 通过，没有使用放宽额度掩盖问题。
- 后端全量最终复核：**237 suites 通过、9 suites 跳过；5328 tests 通过、111 tests 跳过**（共5439）。
- `pnpm --dir backend typecheck`、定向 ESLint（全部本次 TS 文件，无 --fix）、`pnpm --dir backend build`（含92头像资产）、`git diff --check` 通过。

如实记录：首轮全量中未改动的 capability.write-security.http.spec.ts 有一次预期400/实际401；该套件单独15/15通过，未改代码后的完整复核也全通过。未查明偶发失败原因，不把它认定为本次修复导致或已解决的另一生产缺陷；最终没有修改该无关测试。

主要复现命令：

```bash
E2E_TEST=1 pnpm --dir backend test -- --runInBand --runTestsByPath src/modules/notifications/notifications-throttling.http.spec.ts
E2E_TEST=0 pnpm --dir backend test -- --runInBand --runTestsByPath src/modules/notifications/notifications-throttling.http.spec.ts src/modules/security/rate-limit-policy.spec.ts src/common/trusted-proxy.http.spec.ts src/common/middleware/basic-rate-limit.middleware.spec.ts src/modules/gateway/gateway-rate-limit.http.spec.ts src/app.module.di.spec.ts
E2E_TEST=0 pnpm --dir backend test -- --runInBand
pnpm --dir backend typecheck
pnpm --dir backend build
```

## 8. 部署后验收与未核实项

1. 部署后端到所有实例，确认构建和依赖版本、生产没有 E2E_TEST=1。旧实例未更新会继续误限；本次没有实际部署，不能宣称线上已恢复。
2. 使用专用验收身份，等旧阻断过期，在一分钟内分别读取列表与未读数20次：均200、X-RateLimit-Limit:100、不带 Auth/Chat 限流头；Electron 两个IPC调用应正常。
3. 在隔离预发布固定单实例、排除同用户其他请求，各 handler100成功/101返回429；按 Retry-After 等待后恢复。同代理第二个合法用户应仍可读；原用户换token不能规避。生产不要用真实用户通知做批量标记/删除压力测试。
4. 专用测试凭据验证 Web/桌面登录11次、验证码和forgot6次、reset11次仍命中auth；模型预览61次命中chat。验证码/邮件/重置优先隔离环境，避免真实账户副作用。
5. 无效/过期凭证应401；两验收用户确认列表/未读数与读写隔离，单条/批量操作不影响对方。
6. 如需启用 TRUSTED_PROXY_CIDRS，先通过受控请求取得脱敏 peer/req.ip/req.ips 与转发链，核实两个已知出口能正确分辨、伪造XFF不能绕过，再配置明确可信地址并限制直连。该线上配置核查与变更未执行。
7. 观察通知429比例、实际轮询量与响应头。仍有 Auth/Chat 头先排查旧实例/旧构建；default超额按同handler/同用户/单实例计数核实实际请求量。多实例下不以一次负载均衡序列误判精确边界。
