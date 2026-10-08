# 客户端使用记录与 Web 监控同步开发方案 v1

日期：2026-10-08。范围：SEP 后端/Web 和相邻 `sep-client` 仓库。本文是实施与验收依据，不代表已经部署。

## 1. 目标与边界

客户端是任务执行和使用记录的源；云端保存镜像，Web 只读监控。同步方向是客户端 → 云端 → Web，不包含 Web 回写、远程执行/取消、任意文件上传、模型 API 的原始 HTTP 载荷或工具秘密。使用记录包含用户输入、模型最终文本输出、任务状态和创建人。内容先走现有敏感信息脱敏，脱敏后长文本分片传输，不再静默截断到 1000 字。任务正文/附件不会额外扫描上传。

企业管理员 `ENTERPRISE_ADMIN` 默认查询本企业所有成员的云端记录；`MEMBER` / `DEPT_MANAGER` 只查询本人。详情、分页与列表必须使用相同服务端权限。客户端 UI 的“个人工作台”指本人工作视图，不新增独立个人租户/无企业任务模型；无企业用户仍沿用现有权限边界。

现状证据：本地当前任务 10 条（完成 6、未完成 4）；本地镜像队列存在未确认 create；2026-10-08 服务端日志出现 POST /api/client/tasks 429；云端 3 条不是本地 10 条的子集。多个命名限流配置全局生效、登录时并行恢复、大量快速重试形成放大；不能只提高限流或删除队列。

## 2. 协议：兼容现有调用，不改数据库结构

- `POST /client/tasks`：继续以 `(userId, clientTaskId)` 幂等创建/更新，服务端校验企业、订阅和成员授权。同一任务重跑保持 mirrorId；新 run 清理旧的状态/进度/错误/完成时间，保留历史事件及任务级递增序号。禁止复用 ID 跨企业覆盖；订阅改变需重新授权，不能绕过授权。
- `PATCH /client/tasks/:id/status`、`POST .../events`：新增可选 `clientRunId`，新客户端必须发送。状态拒绝陈旧 run；事件以明确 run 标识归档，序号采用任务级单调递增，重复安全。旧客户端省略时兼容当前 run。
- 事件保留 `type=user_input|model_output`、`message` 每片最多 1000 字符、`sequence`、`occurredAt`。长文本使用 `stepKey=content:v1:<messageId>:<index>:<total>`（index 从 0 开始），Web 按 run+type+messageId 组装，缺片必须提示，禁止跨 run 拼接。短文本保持无 stepKey 的旧协议。messageId 是客户端随机 ID，不包含正文。整个正文先脱敏再分片。
- `GET /client/tasks` 无分页参数保留数组响应（最近 100 条）；带 `page` / `limit` 返回 `{items,total,page,limit,hasNextPage}`，limit 最大 100、默认 50，稳定按 updatedAt desc / id desc 排序。
- 可选 `scope=mine|enterprise`：默认沿用角色范围；mine 强制本人；enterprise 仅企业管理员可用。客户端不能通过 scope/userId 指定读取他人。
- 列表包含最小创建人摘要 `user:{id,name}`，不返回 email/token。详情保持 `{...mirror,events}`，事件包含 clientRunId，兼容旧事件展示。
- 本次不新增持久化表、不修改 Prisma migration；不引入依赖。

## 3. 后端实施

1. 先加任务镜像权限、重复创建/上报、重跑、分页、越权详情回归测试，mock Prisma，不连真实数据库。
2. 任务镜像路由显式跳过不相关的 auth/chat 命名桶，保留 default 限流（不能跳过所有限流）。不改变登录/认证/其他接口的限流。
3. 所有新增 query/body 用 shared Zod DTO，Swagger 描述响应与错误。429 保留 Retry-After。
4. 重跑/幂等行为保持上述规则。重复 create 不重复重置同一 run；历史补偿与客户端状态 reconcile 不应把已成功任务重新变成排队中。

## 4. 客户端实施

1. 沿用作用域隔离、原子落盘的 outbox，先落盘再发送。按任务串行和全局发送串行/限速，恢复不能 Promise.all 无上限打满创建接口。
2. 解析 Retry-After（秒数/HTTP 日期），429 应尊重服务端窗口；网络/408/5xx 指数退避，上限有界；401 继续现有刷新策略。400/403 等不进行紧密无限重试，不删除 pending，日志不包含模型正文或远端错误原文。
3. 登录后启动补偿循环（约 30 秒）并立即恢复；恢复重入保护、登出/stop 清理定时器，按当前登录企业/用户隔离。异步请求再次验证 scope，防止登出/切账号后使用新 token 发送旧用户队列。
4. 补齐任务 started / finished 状态，涵盖 RUNNING、PAUSED、WAITING_APPROVAL、FAILED、CANCELLED、COMPLETED。INTERRUPTED 映射 PAUSED。不能因“收到一个模型输出”就认定整个任务已完成；由实际运行结束决定终态。
5. 新 run 的每个 pending operation 携带其 run ID，不能从当前最新 run 误归属历史正文；序号单调递增。
6. 现存 pending 队列自动重放；启动后用本地快照/run 的真实终态追加 reconcile，纠正旧客户端误标 COMPLETED。对本地有而 outbox 缺失的历史任务，使用已持久化 run/消息补建镜像（读取现有 data API，不绕过目录边界）；记录已入队的回填标记，避免每次登录重复上传。历史文本如已截断且无法从事件恢复，不能伪称完整同步。
7. 单元测试覆盖重试、429 时间窗、串行恢复、生命周期、身份切换、长文本完整性、重复恢复、历史补偿和失败终态。

## 5. Web 实施

- TanStack Query 查询分页列表，轮询 15 秒、详情 10 秒；显示总数、翻页、创建人、状态、更新时间。
- 默认尊重服务端角色范围，不自行在前端扩大权限。使用稳定分页 query key，详情 key 与旧查询兼容。
- 展开详情分“用户输入”“模型输出”展示正文，保留换行与长内容可读性；分片组装且缺片有提示；历史事件仍有可读展示。不只显示内部事件名/单行省略号。
- 空、加载、错误、分页错误均可见，不能把同步失败当成没有本地任务。云端页面说明“仅显示已同步到云端的记录”。
- 组件和 hooks 单测覆盖列表无客户端筛选、分页、归属、长文本/分片、缺片、错误和旧记录兼容；做实际页面/截图验证。

## 6. 验收矩阵

| 场景 | 标准 |
|---|---|
| 同企业管理员 | 可看所有成员记录及正文，不能看其他企业 |
| 普通成员/部门负责人 | 只看本人，直接请求他人详情 404，enterprise scope 403 |
| create 重复/响应丢失 | 一条镜像；同 run 不重置终态 |
| 任务重跑 | 相同镜像 ID，正确新状态，正文按 run 归属 |
| 长输入输出 >1000 字符 | 脱敏后文字逐字一致，组装无丢失/重复，缺片可识别 |
| 离线/429/5xx | 本地正常执行，队列不丢；恢复网络/窗口后自动补偿 |
| 登出/切账号 | 停止旧队列，不能向新账号发送旧 scope 内容 |
| 未完成/失败/暂停 | Web 状态与客户端真实终态一致，不误报完成 |
| 本地已有 10 条 | 已有队列可重放；无队列且可恢复的记录可回填；按 taskId 对账，不要求云端只有10条（企业含其他用户历史） |
| >100 条 | 分页可访问，不受旧版数组100条限制 |

## 7. 发布与风险

先部署后端兼容接口，再发布客户端及 Web；先验证匿名/越权、10 条任务 ID 对账、长文本、429 恢复与状态一致性。生产部署、重启、主动上传历史正文属于外部行为，本轮未经额外要求不执行。测试只用 mock/临时目录，不直接运行生产 smoke 写入脚本。不承诺本地删任务即删除云端（审计记录独立保留）。详情暂沿用完整事件响应，超大历史事件增量分页作为后续优化。

## 8. 实施记录

### 8.1 本轮已完成

已按本文完成客户端 → 后端镜像 → Web 监控链路的第一版实现，未新增数据库表或 Prisma migration，未改变 Web 回写/远程控制边界。

**后端（`/Users/yao/LLM/SEP`）**

- `backend/src/modules/client/client.service.ts`
  - 按 `(userId, clientTaskId)` 幂等创建；同 run 重放不重置状态；新 run 保留镜像 ID、历史事件和任务级 sequence 水位。
  - 创建、状态、事件接口校验企业/订阅/grant 有效期；拒绝跨企业复用。
  - `ENTERPRISE_ADMIN` 默认查询本企业；`MEMBER` / `DEPT_MANAGER` 默认只能查询本人；`scope=enterprise` 对非管理员返回 403。
  - 支持分页列表、创建人摘要、详情事件、旧客户端数组响应兼容；显式旧 run status 冲突返回 409。
  - 任务镜像路由仅跳过不相关的 auth/chat 限流桶，保留 default 限流和 `Retry-After`。
- `backend/src/modules/client/client.controller.ts`
  - 补充分页参数、Swagger 响应和限流说明。
- `backend/src/shared/client-task.dto.ts`
  - 补充分页/scope DTO；事件保留正文空白并限制单片最多 1000 个 UTF-16 字符。
- `backend/src/modules/client/client-task-mirror.spec.ts`
  - 覆盖幂等、权限、越权、分页、重跑、序号幂等、过期授权和并发冲突。

**客户端（相邻仓库 `/Users/yao/LLM/sep-client`）**

- `electron/common/platform/client-monitor-api.ts`
- `electron/common/platform/client-monitor-contract.ts`
- `electron/data/client-monitor-store.ts`
- `electron/service/client-monitor-service.ts`
- `electron/service/client-monitor-history-service.ts`
- `electron/bootstrap/build-backend.ts`
- `electron/runtime/conversation-executor.ts`
- `electron/runtime/task-runtime.ts`

实现了持久化 outbox、按任务及全局串行发送、429 `Retry-After` 秒数/日期解析、网络/408/5xx 有界退避、登录立即恢复与约 30 秒补偿、scope/epoch 隔离、停止/登出取消、长文本脱敏后分片、纯空白正文保留、历史 run 归属、旧 run 409 安全跳过、真实终态上报以及历史回填/reconcile。历史回填只读取已有本地任务、run、message 和 timeline，不主动执行任务，不向真实服务上传本轮测试数据。

对应测试文件：

- `electron/common/platform/client-monitor-api.test.ts`
- `electron/service/client-monitor-service.test.ts`
- `electron/service/client-monitor-history-service.test.ts`
- `electron/runtime/task-runtime-monitor.test.ts`

**Web（`/Users/yao/LLM/SEP`）**

- `web/src/features/task/use-client-task-mirrors.ts`
- `web/src/features/task/client-task-content.ts`
- `web/src/features/task/components/client-task-monitor.tsx`
- `web/src/lib/query-keys.ts`
- 对应测试：`web/src/features/task/client-task-content.test.ts`、`use-client-task-mirrors.test.tsx`、`components/client-task-monitor.test.tsx`。

Web 已支持分页/总数、创建人、更新时间、状态、输入/输出正文、长文本分片组装及缺片提示，并明确显示“仅显示已同步到云端的记录”；不在前端自行扩大权限。

### 8.2 验证记录

- 后端：`client-task-mirror.spec.ts` 与 `client.service.spec.ts`，**2 个套件、58 项通过**；后端 TypeScript typecheck 通过。
- Web：针对性测试 **3 个文件、21 项通过**；Web TypeScript typecheck 通过；此前 Web 全量 **62 个文件、576 项通过**。
- 客户端：`npm run test:tasks`，**489 项测试中 488 项通过、1 项 skipped、0 项失败**；`npm run typecheck` 通过；`npm run check:boundaries` 通过；`npm run build` 通过。
- 浏览器 mock 验收：使用隔离 Playwright session 和本地 mock API，验证企业管理员分页、详情展开、长文本完整组装、缺片警告、翻页和移动视口；截图位于 `outputs/client-monitor-verification/desktop.png`、`desktop-details.png`、`mobile.png`。本次 mock 未调用生产接口；页面 console error 为 0，但浏览器环境仍有非错误 warning，不能表述为“零警告”。
- 已执行两个仓库 `git diff --check`，通过。

### 8.3 未验证项与方案偏差

- 未部署、未重启生产服务、未执行真实网络上传，也未主动把本地历史 10 条记录回填到云端；因此尚未完成线上按 `clientTaskId` / `mirrorId` 的 10 条对账。
- 由于没有新增数据库结构，本轮未执行 `db:migrate`；现有工作区中的其他 schema/migration 修改不属于本同步功能，未回滚。
- 极端乱序且缺少世代号的不同 run create 仍存在理论上的旧 create 晚到风险；旧客户端不带 `runId` 的事件按兼容规则归属当前镜像。
- 详情接口仍一次返回全部事件，超大历史事件的增量分页留作后续优化。
- 如果历史正文在旧逻辑中已被截断且本地没有 canonical message/timeline 可恢复，无法凭空补回；系统会保留可恢复内容，不虚报完整同步。

### 8.4 发布顺序

正式上线建议按“后端兼容接口 → 客户端上传/补偿 → Web 展示”顺序发布。上线前必须用测试企业验证：管理员与普通成员权限、不同企业隔离、429 恢复、长文本逐字对账、失败/暂停/取消终态、历史记录按 taskId 对账。完成模块后可由项目负责人自行提交 Git；本轮未执行 commit、push 或部署。
