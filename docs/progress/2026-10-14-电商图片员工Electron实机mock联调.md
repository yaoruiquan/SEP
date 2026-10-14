# 电商图片员工 Electron 实机 mock 联调

日期：2026-10-14。范围：先提交已有开发，再 review 最近媒体/批准安装提交、修复并验证真实订阅账号的 Electron 图片 mock 闭环。没有推送、生产部署、真实模型调用或计费。

## 1. 提交与 Review

开始前已提交 SEP `41c895d` 与客户端 `6c8ed06`。本轮重点续查 SEP `a539b4e`、`1550a86`、`9e43ac9`、`41c895d`，客户端 `de74e2d`、`41843ff`、`0dc107b`、`6c8ed06` 相关实现；不声称审查了所有无关提交或脏文件。

已修复并补回归：

| 问题 | 修复 |
| --- | --- |
| 数据库 claim 等待期间撤权或订阅过期，仍可能 dispatch | claim 后 dispatch 前重新验权，并再次检查截止时间；未执行的请求保留确定 FAILED，原幂等 ID 不重新执行；授权 DB 异常返回脱敏 503 |
| Pi 默认本地同名 Skill 可影响批准入口 | 员工会话禁用默认发现，仅加载显式冻结路径；用实际 SDK loader 核对最终入口、名称、元数据与准备时 hash，reload/extend 不匹配时拒绝；普通会话保留默认发现 |
| 正常 `currentVersion: null` 元数据阻断真实员工授权 | 接受未批准能力并过滤；runtime 声称不存在批准版本时仍拒绝 |
| 真实应用工作详情没有图片面板 | 对话式工作详情复用现有 MediaArtifactsPanel 与样式，流程式工作不新增该操作入口 |
| 并发更新同一批准 Skill 元数据竞争备份 rename | 沿用 instance WriteChain，以绝对文件路径串行化；覆盖最终顺序、前一版备份、权限与 scope；不宣称跨进程文件锁 |
| token 服务 429/网络/5xx 被误判为登录失效 | 保留 RATE_LIMITED/NETWORK_ERROR/SERVICE_UNAVAILABLE 并脱敏，真实授权错误仍暂停；联调入口复用 EmploymentTokenManager 缓存与现有 refresh rotation，不放宽后端限流 |
| 实际工作目录长路径溢出信息栏 | 限制路径容器宽度并允许文本收缩，保留省略号与复制按钮；Electron 1200/980 像素窗口实际断言通过 |

Skill loader hash 基线是准备加载时的本地入口字节；安装仍有服务端 artifact/hash 校验，但本轮不将其宣称为抵御恶意本地文件修改的独立防篡改机制。

独立 review 子代理遇到服务 503，未取得独立审查结论；以上为本会话源码检查、回归与实机验证，不记为独立 review 0 findings。另一会话的 Unicode/ZIP 安装开发不纳入本轮提交；四个重叠 Skill 文件只暂存本轮入口隔离与 null 版本兼容，工作区的并行修改保留。

## 2. 实际订阅与边界

- 登录使用现有公开 demo 员工账号，实际调用 `POST /api/client/auth/login` 创建客户端 session/device；不 seed、不改密码、不伪造 access/employment token。
- “国内电商运营专家”已有 ACTIVE 订阅，用于图片 mock 创建、编辑、审批、保存及恢复。当前没有批准的电商图片 Skill；没有擅自创建或批准。
- “前端工程师”现有批准 UI Designer 单文件 Skill 1.0.8，用于批准产物下载/hash/安装验证。13855 字节，SHA256 `ada069e0a7dd6e285bbe39ac1e85b675f3d5f455724f36aac093844986908dfe`。不能将其写成电商图片 Skill 已发布。
- 普通 access token 访问 runtime/artifact，employment token 访问媒体。ClientEmploymentGuard、SessionService、业务库成员/部门/订阅授权与 Redis 为真实实现。
- 媒体服务仅以显式 `NODE_ENV=development`/`MEDIA_GATEWAY_MOCK_ENABLED=true` 开关在 loopback 3002 启动；媒体记录写入既有隔离库 `sep_media_mock_20261014`，不回退到业务 DATABASE_URL、不运行迁移。真实登录会正常写入业务 session，不等于业务库完全只读。
- 首轮使用已有 SEP 3001 服务；中间重跑时该服务停止监听，两次登录未完成，不能将其归因为已证实的 429。最终从本轮暂存快照运行 `media-electron-auth-server.ts`，复用真实 ClientModule/AuthModule、SecurityModule 与 Redis，绑定 loopback 3001，不加载 TaskExecutionModule/后台队列，不伪造认证或放宽限流；它不是完整平台所有路由的启动验收。
- 客户端使用临时隔离 profile，不读取正常客户端凭据；实际 Electron main/preload/renderer/IPC/本地 store 与 HTTP 服务运行。测试窗口隐藏以避免桌面输入干扰；文件选择/导出原生对话框由自动化提供固定路径，后续文件读取、落盘和校验是真实操作。
- 图片为固定 1×1 PNG，账务 `MOCK_NOT_CHARGED`；生产 runtime 保持 `executionAvailable:false`、`tools:[]`。不执行 Pi 聊天 prompt，不调用付费模型，不验证图片质量。

## 3. Electron 通过证据

`scripts/test-electron-media-mock.mjs` 在真实 Electron 应用中完成：

1. 登录、获取真实订阅、下载并安装批准 Skill，核对实际入口 SHA256。
2. 工作记录进入真实 WorkDetailPage；导入固定参考图，确认参考传输，再确认报价与编辑。
3. 同步编辑达到 SUCCEEDED/SAVED/MOCK_NOT_CHARGED；renderer 图像 complete/naturalWidth=1，大图预览截图通过实际查看，导出文件 hash 一致。
4. 异步任务取得 QUEUED/RUNNING 回执且本地尚未保存后注入媒体断线，正常退出应用。
5. 同 profile 重新启动 Electron、重新真实登录，查询同 job/request 回执并保存；UI 展示原任务已保存到本地。

两进程合计仅 2 次 POST requests（同步编辑和异步生成各一次），重启恢复没有再提交；employment token 共 3 次成功请求，无 429；外部/模型 fetch 拦截计数 0，媒体错误为空；两个进程退出码均为 0。此为正常应用退出重启，不是 SIGKILL、后端重启或异常崩溃测试。

最终通过证据位于客户端 `outputs/electron-media-mock-2026-10-14-final-layout/`：`evidence.json`（`passed:true`）、`electron-preview.png`、`electron-restart-recovery.png`、`electron-work-detail-compact.png`、`exported-mock.png`。恢复任务 ID 为 `4472cdc0-37ef-46d1-ba90-456fb1e95a03`；已查看恢复/紧凑布局截图。首次目录的 `evidence.json` 被后续失败重跑覆盖，不作为最终通过凭据；另一次完整通过保留在 `-final/` 目录。只保留本地，不将临时 profile、credential vault 或整个 outputs 目录加入 Git。

## 4. 验证与复跑

- SEP 针对性 4 套件、160 项通过：media gateway service/HTTP、client artifact service、client service；backend typecheck/build、相关 ESLint、diff 检查通过。
- 客户端首次 19 套件、226 项通过；最终对仅含本轮暂存文件的独立快照扩大回归，29 套件、325 项通过、无跳过，覆盖 adapter/employee loader/skill packages、SkillVersionStore、媒体服务/存储/HTTP、授权与实际工作详情/UI。两次数字不累加。
- 客户端 typecheck、相关 ESLint、架构边界、四项 Pi SDK POC、标准 electron-vite 构建与 mock 专用构建通过。构建不调用生成配置脚本，不覆盖并行开发的 runtime-config。
- Electron runner `passed:true`，四阶段及两档宽度的路径边界/复制按钮断言通过。认证 helper 拒绝 production 配置的启动验证通过（预期 exit 1）。测试临时服务在验证后关闭，不停用户已有 Web 或其他服务。

复跑先准备显式隔离 PostgreSQL URL，不把密码或 `.env` 写入记录。在 backend 运行：

```bash
NODE_ENV=development MEDIA_GATEWAY_MOCK_ENABLED=true \
MEDIA_GATEWAY_TEST_DATABASE_URL="$ISOLATED_MEDIA_DATABASE_URL" \
pnpm exec ts-node -r tsconfig-paths/register --project tsconfig.json test/media-electron-mock-server.ts
```

需已有真实认证服务。如果本地 3001 空闲，可另一个终端仅启动真实认证/客户端模块，不启动后台任务：

```bash
NODE_ENV=development SEP_ELECTRON_MEDIA_MOCK=true \
pnpm exec ts-node -r tsconfig-paths/register --project tsconfig.json test/media-electron-auth-server.ts
```

客户端运行：

```bash
npx electron-vite build --config electron.media-mock.config.ts
SEP_ELECTRON_MOCK_OUTPUT="outputs/electron-media-mock-$(date +%Y%m%d-%H%M%S)" \
node scripts/test-electron-media-mock.mjs
```

依赖真实认证/客户端 3001、Redis、数据库和两个实际员工订阅；不是离线 fixture 测试。不新增依赖，不修改业务 schema。

## 5. 下一步

先以现有 Skill 审核流程准备并批准电商图片 Skill，然后验证它在 Pi 中调用受控 mock 图片工具；本轮只验证表单驱动的图片链路及另一员工的批准安装。客户端 ZIP 安装、正式生产媒体接线、跨平台和异常崩溃恢复仍待补充。真实 sub2api 图片适配与收费启用前，必须明确结果缓存/留存、商业报价、扣费/退款和预算授权，不把本次 mock 验收当生产生图闭环。
