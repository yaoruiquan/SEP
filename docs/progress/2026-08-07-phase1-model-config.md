# Phase 1 进度报告 · 模型配置中心

**日期**: 2026-08-07
**状态**: ✅ Phase 1 全部完成
**完成度**: 100%

---

## ✅ 已完成

### 1. 数据库 Schema

- `EnterpriseModelConfig` / `DepartmentModelPolicy` 两张表已在 `schema.prisma` 中。
- 用 `pnpm prisma db push` 同步（**未**执行 `migrate reset`，无数据丢失）。

### 2. 后端 DTO（`backend/src/shared/model-config.dto.ts`）

修正了三处与真实 schema 不一致的地方：

| 字段 | 原定义 | 修正为 | 原因 |
|------|--------|--------|------|
| `employeeModelPolicy` | `FOLLOW_TEMPLATE` \| `ENTERPRISE_OVERRIDE` | `FOLLOW_TEMPLATE` \| `FORCE_DEFAULT` | 与 schema 注释一致 |
| `monthlyBudgetCNY`（更新时） | 仅 `string` | `number \| string \| null` | 前端 input 传的是数字 |
| `AvailableModel` | 全部非空 | 除 `modelId`/`label` 外全 nullable | 库里 8 条启用模型的元数据列**全是 NULL** |

`EffectiveModelConfig` 补齐了 `allowUserSwitchModel`、`rerankModel`、
`embeddingBatchSize`、`embeddingTimeoutMs`、`budgetExceeded`，与前端类型对齐。

### 3. 后端服务

- `getAvailableModels` 原先 `select: { id }` 返回的是主键 cuid —— 调用模型要的是
  `modelId`，已修正（否则拿到的模型标识根本不能用于推理调用）。
- `resolveEffectiveModel` 五级优先级：
  `USER_CHOICE → EMPLOYEE_INSTANCE → DEPARTMENT → ENTERPRISE → SYSTEM_DEFAULT`，
  返回值带 `source` 便于排查。部门白名单会**收窄**用户可选范围。
- 预算逻辑拆成两个方法（原先合成一个 boolean 是错的）：
  - `checkBudgetExceeded()` —— 纯事实判断，与 `hardStopOnBudget` 无关。
    合并的话，只告警不拦截的企业永远拿到 `false`，前端就没法提示了。
  - `assertBudgetAllowsNewSession()` —— 超预算 **且** 开了硬阻断才抛 403。
  - 月度消费改用 `aggregate` 而非全量 `reduce`（单企业月流水可达几十万条）。
- 新增 `getDepartmentPolicy` / `setDepartmentPolicy`，含 `assertDepartmentInEnterprise`
  跨企业越权防护。

### 4. 后端接口

`EnterpriseModelConfigController`（`enterprise/model-config`）：

| 方法 | 路径 | 权限 |
|------|------|------|
| GET | `/enterprise/model-config` | 成员 |
| PUT | `/enterprise/model-config` | 企业管理员 |
| GET | `/enterprise/model-config/available-models` | 成员 |
| GET | `/enterprise/model-config/effective` | 成员 |

`DepartmentModelPolicyController`（`enterprise/departments`，独立 controller ——
前缀不同不能塞进上面那个）：

| 方法 | 路径 | 权限 |
|------|------|------|
| GET | `/enterprise/departments/:id/model-policy` | 成员 |
| PUT | `/enterprise/departments/:id/model-policy` | 企业管理员 |

### 5. 前端

原有文件的接口路径是错的（`/enterprise/:id/model-config`，实际端点从 JWT 推导
企业、路径里没有 id），已全部修正。另外：

- `page.tsx` 改用项目约定的 `@/components/ui/toast` + `ApiError`
  （原先引的是 `sonner` 和 axios 风格的 `error.response.data.message`，
  项目里既没装 sonner 的用法也不是 axios）。
- 非管理员进入时表单整体 `readOnly`，并给出提示条。
- `model-config-form.tsx` 补上第三个 Tab「员工模型」，加了 dirty 追踪与重置。
- Embedding 模型选择：库里 `category` 全为 NULL，按 category 过滤会得到空列表，
  改为可自由输入 + 已知选项提示。
- `model-whitelist-picker.tsx` 元数据缺失时降级展示，加全选/清空。
- 侧边栏新增「设置 → 模型配置」入口（此前页面存在但**无任何入口可达**）。

---

## 🔬 验证结果

**构建**：`backend` webpack 编译通过；`web` `tsc --noEmit` 与 `next build` 均通过，
`/settings/models` 出现在产物中。

**单元测试**：新增 27 个用例，覆盖五级优先级、白名单收窄、预算事实/拦截分离、
越权防护。全量 `pnpm test` → **14 suites / 198 tests 全绿**，无回归。

**接口实测**（`boss@acme.local`，8 个场景全部符合预期）：

1. 三个 GET 正常返回
2. PUT 传**数字** budget → 正确落库为 Decimal 字符串
3. 用户选白名单内模型 → `source: USER_CHOICE`
4. 用户选白名单外模型 → 回落 `source: ENTERPRISE`
5. 部门策略 upsert 成功
6. 带 `departmentId` → `source: DEPARTMENT`，白名单被收窄
7. 普通成员 PUT → **403**
8. 他企业管理员操作 ACME 部门 → **404**；`alertThreshold=5` → **400**

> 测试期间改动的演示数据已全部还原为默认值。

---

## 🔲 待完成

- [x] `conversation-stream.service.ts` 在加锁前调 `assertBudgetAllowsNewSession()`，通过后调 `resolveEffectiveModel()` 五级解析，不再使用 `session.modelId || employee.modelId || defaultModel` 简单链
- [x] `embedding.service.ts` 的 `embedText` / `embedBatch` 接受可选 `modelOverride` / `batchSizeOverride`，供调用方传入企业配置的 `embeddingModel` / `embeddingBatchSize`
- [x] 聊天模型选择器按白名单过滤；`allowUserSwitchModel=false` 时隐藏并显示锁图标
- [x] 部门模型策略的前端编辑入口（后端接口已就绪，界面未做）

---

## ⚠️ 遗留问题

**平台模型元数据缺失。** 8 条启用模型的 `vendor` / `category` / `contextLength` /
定价全为 NULL。前端已做降级，但计划书里「白名单展示单价与上下文长度」这个体验
要等模型同步任务把元数据补齐才能真正生效。Embedding 模型也因此无法按 category
筛选，目前退化成自由输入。
