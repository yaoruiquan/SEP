# 2026-07-28 开发日报：P1 企业组织层完整落地

## 今日交付

### 提交清单

| 提交 | 类型 | 内容 |
|---|---|---|
| `9d84c21` | feat | P0 企业组织基座 + 多租户隔离 |
| `1bee741` | feat | 企业自助注册 + Zod 运行时校验 |
| `7c29305` | feat | P1 第一块：部门树与成员管理 |
| `b040f3b` | fix | tsc OOM 根因修复（OOM → 2.2 秒） |
| `f4376a6` | feat | P1 第二块：员工实例管理 |
| `79083f5` | docs | 状态文档同步至 P1 第二块 |
| `5a40757` | chore | 删除无鉴权的 agent-runtime 探针模块 |
| `dc5bb29` | feat | P1 第三块：员工授权 + NULL 唯一约束修复 |
| `706c58a` | feat | P1 第三块：前端路由组重构 + 授权数据层 |
| `df76b13` | feat | P1 第三块：部门/成员/我的员工三页面 |
| `2dcc0b3` | chore | 收录三个 E2E 验证脚本 |

### 验证数字

| 范围 | 结果 |
|---|---|
| 全量单元测试 | **131 / 131** |
| P1 第一块 E2E（部门 + 成员） | **21 / 21** |
| P1 第二块 E2E（员工实例） | **12 / 12** |
| P1 第三块 E2E（员工授权） | **11 / 11** |
| 前端页面真机验证 | **11 / 11** |
| `npx tsc --noEmit` | 干净（2.2 秒）|
| `next build` | 20 页全通 |

---

## 核心交付

### 企业组织层（P1）

在已有单用户视角的基础上，完整补齐「以企业为核心」的数据层和接口层。

**P0：基座**
- 6 张新表：Enterprise / Department / EnterpriseMember / EmployeeInstance / EmployeeGrant / AccessRequest
- `Subscription` / `ComputeAccount` 主体由 User → Enterprise
- `DigitalEmployee` 加 `version` 字段（提示式升级的基础）
- `EnterpriseContextService` —— 多租户单一数据源，所有服务通过它解析 `enterpriseId`
- `ZodValidationPipe` —— 补齐运行时校验（Zod DTO 无 class-validator decorator，原有全局 pipe 等于空壳）
- 注册流程：一个事务建 User + Enterprise + 首个 ENTERPRISE_ADMIN + ComputeAccount

**P1 第一块：部门 + 成员（9 个接口）**
- 部门树 API：flat 查询 + 内存组装，含环检测（移动到自己的子孙下）+ 跨企业挂载拦截
- 删除部门不级联，要求先清空子部门和成员（防止隐式批量损毁）
- 成员增删改：最后一名管理员不可降级/移除，管理员不能自降角色，代建账号在事务内同时建 User

**P1 第二块：员工实例（5 个接口）**
- 订阅是使用权，实例是部署一份；一次订阅可建多个实例（无唯一约束）
- 创建时锁定 `templateVersion`，模板发新版只提示不自动跟进（决策 14）
- 升级只改版本号，不迁移 config，返回 `configReviewRequired`
- 停用 / 回收不删授权记录，实例恢复后原授权继续有效
- 状态机：`PENDING_ACTIVATION → ACTIVE / REVOKED`，`ACTIVE ↔ SUSPENDED`，`REVOKED` 终态

**P1 第三块：员工授权（4 个接口）+ 前端三页面**
- 授权对象二选一（部门或成员），DTO 层 refine 强制
- 「我的员工」合并直接授权和部门授权（OR），只返回实例 ACTIVE 且授权未过期的，直接授权优先
- 前端路由组：`(auth)` / `(market)` / `(enterprise)` / `(platform)`，市场无 AuthGate 公开可浏览
- 根路径从 `/login` 改跳 `/marketplace`
- `enterprise-shell` 按角色过滤导航：「组织」组仅企业管理员可见
- 注册页补 `enterpriseName` 字段（注册即开公司）

### 三个管理页面

- **部门管理**：可折叠递归树，hover 显示增/改/删操作
- **成员管理**：表格 + 代建账号弹窗，角色/部门/职位可编辑
- **我的员工**：成员视角卡片列表（授权来源徽章）+ 管理员视角实例表格和授权面板

---

## 今日修掉的三个真 Bug

### Bug 1：tsc OOM（AI SDK v7 泛型递归展开）

**现象**：`tsc --noEmit` 和 `nest build` 在 4GB heap 反复 mark-compact 后 OOM，构建无法产出 `dist/`。

**根因**：`generateText` 的 `TOOLS` 泛型会从 `inputSchema` 反推工具参数类型。把 Zod v3 的 `ZodObject` 交给 `inputSchema` 时，TypeScript 要对 `FlexibleSchema`（Zod4 `$ZodType` | Zod3 `Schema` | AI SDK `Schema` 三路联合）逐路展开，每路都要递归 ZodObject 内部 shape，多个工具时是乘性增长。单文件即可触发 TS2589。

**修法**：改用 `jsonSchema()` —— AI SDK 为运行时 schema 设计的零推断路径，参数是普通 `JSONSchema7`，返回 `Schema<unknown>`，无递归。`tool()` 运行时是 `return tool2`，纯恒等函数，一起去掉。

**结果**：全量 tsc OOM → **2.2 秒**。

### Bug 2：`EmployeeGrant` 唯一约束 NULL 语义失效

**现象**：重复开通同一授权返回 201 而非 409。`catch P2002 → 409` 这段代码是死代码。

**根因**：`@@unique([instanceId, departmentId, memberId])` —— 授权对象二选一，三列必有一列为 NULL；Postgres 视 NULL 互不相等，故约束永不触发。同一个坑 P0 播种时用 `skipDuplicates` 绕过，没治根，此次复发。

**修法**：手写迁移，先去重（保留最早一条），删掉旧索引，建两个部分唯一索引：
```sql
UNIQUE (instanceId, departmentId) WHERE departmentId IS NOT NULL
UNIQUE (instanceId, memberId)     WHERE memberId IS NOT NULL
```
`schema.prisma` 无法表达 `WHERE` 子句，留注释指向迁移，标注「不要把 @@unique 补回来」。

### Bug 3：改个人资料漏传企业信息

**现象**：修改昵称后，企业台侧边栏企业名消失，角色过滤失效（所有导航出现）。

**根因**：`use-user.ts` 里 `setAuth(token, user)` 的旧签名只传了两个字段，`enterprise` 和 `roleInEnterprise` 被重置为 null。

**修法**：更新为 `setAuth({ token, user, enterprise: store.enterprise, roleInEnterprise: store.roleInEnterprise })`，改个人资料只更新 user 不触碰企业信息。

---

## 产品决策落地情况

| 决策 | 落地状态 |
|---|---|
| 部门经理暂按普通成员（先砍掉） | `ASSIGNABLE_ENTERPRISE_ROLES` 不含 DEPT_MANAGER，assertCanApprove 收紧为仅 ADMIN |
| 一次订阅可开多个实例 | InstanceService 无 `[enterpriseId, templateId]` 唯一约束 |
| 提示式升级（决策 14） | `upgradeAvailable` 字段 + POST upgrade 只改版本号 + `configReviewRequired` |
| 停用不删授权记录 | changeStatus 只改 status，GrantService 的 `myEmployees` 过滤 `status=ACTIVE` 的实例 |
| 授权两条路径都算（直接 + 部门） | `myEmployees` OR 两个 findMany + 去重 + `grantSource` 标识来源 |
| 授权最小版（管理员可开通/收回） | POST + DELETE grant 接口，面板内二选一切换 |
| 订阅所有人可见但仅管理员可改 | 导航对所有角色显示「我的订阅」；后端 assertEnterpriseAdmin 守写操作 |
| 对话中心从导航移除 | enterprise-shell 导航不含 /chat 入口 |
| 市场公开可浏览 | (market) 路由组无 AuthGate；根路径跳 /marketplace |
| 注册即开公司 | 注册表单含 enterpriseName；后端单事务建四张表 |

---

## 遗留与下一步

### P1 尾项（小）
- `web/tsconfig.tsbuildinfo` 已移出 git 追踪，但文件还在本地（gitignore 已覆盖，下次 build 后自然消失）
- 演示数据里遗留的 E2E 测试实例（4 条）今天已清理

### P2 优先级排序（参考 `docs/plans/项目升级开发顺序方案v3.md`）

1. **人才市场主线** —— 员工目录（搜索/筛选）、员工详情（capabilities 展示）、订阅入口（需登录）
2. **订阅改造** —— 现有订阅 UI 已是企业视角，后端 `Subscription` 主体已改 enterprise，确认接口形状后前端小改
3. **授权界面完善** —— EmployeeGrant 的增删已有，实例详情页（查看配置、停用、升级）尚未做
4. **算力用量空架子** —— 决策里只要前端能看到就行，后端已有 ComputeAccount，做个图表页

### 技术债（无阻塞影响但应跟进）
- AI SDK v7 泛型是 tsc 内存雷区（技术债第 9 条）：新加 `tools` 调用点时用 `jsonSchema()` + `ToolSet`，不要内联 Zod schema
- DEPT_MANAGER 是空壳角色，要名副其实需要「数据范围」那层（只能管本部门），目前按普通成员对待
- 授权 `expired` 记录只标灰不自动清理，生产前考虑定时任务
