# 2026-07-25 开发进度（下半场）— 模型动态同步 + 系统设置

> 上半场见 [2026-07-25-billing-system.md](./2026-07-25-billing-system.md)（计费系统）
> 本篇主线：上游模型实时同步 → 会话级模型切换 → 管理端系统设置（含密钥加密）

---

## 一、写给老板（通俗版）

解决了一个"看不见新模型"的老问题。

以前平台里能选的 AI 模型是**写死在代码里的 7 个**，上游供应商新上了模型，我们平台看不到，得改代码重新发布才行。今天改成了**实时同步**：平台每次打开模型列表，都直接去问上游"你现在有哪些模型"，**实测拿到 57 个**，比原来多了 50 个。以后上游加新模型，我们这边刷新就有，不用动代码。

另外做了两件配套的事：

1. **对话中可以换模型了**。以前一个数字员工绑死一个模型，现在聊天窗口右上角有个下拉框，随时可以换成更聪明（或更便宜）的模型，换完这个会话后续都用新的。
2. **上游渠道可以在后台配了**。以前改上游地址和密钥要登服务器改配置文件、重启服务；现在管理员在"系统设置"页面就能改，还有个"测试连接"按钮当场验证通不通。密钥是加密存的，页面上也不会显示出来。

---

## 二、遇到的问题和解决办法

### 2.1 硬编码模型列表与上游脱节（本次主因）

- **现象**：前后端各维护一份 `MODEL_CATALOG`（7 个模型），且需手动同步两处。
- **根因**：设计时把模型目录当静态常量。实测上游 `GET /v1/models` 返回 **57 个**，硬编码列表已严重滞后。
- **解决**：新增 `ModelService.listAvailable()`，后端实时 fetch 上游 `/v1/models`，映射为 `{id,label}` 返回；前端 `useAvailableModels()` 拉取（`staleTime: 5min`）。删除 `web/src/lib/models.ts` 里的硬编码数组，只留 `DEFAULT_MODEL_ID` 兜底常量。

### 2.2 `SecretCipher is not a constructor`

- **现象**：后端启动即崩，`ExceptionHandler` 报该错。
- **根因**：`secret-cipher.ts` 导出的是**函数**（`encryptSecret`/`decryptSecret`），但 `SettingService` 里按**类**用了 `new SecretCipher(key)`。
- **解决**：`SettingService` 改为函数式调用，构造器只保存 `masterKey`（从 `JWT_SECRET` 派生，避免多维护一个 `ENCRYPTION_KEY`）。

### 2.3 `Property 'systemSetting' does not exist on type 'PrismaService'`

- **现象**：新建表并 migrate 后，TS 仍报 Prisma client 上无该模型。
- **根因**：dev server 持有旧的 Prisma client 类型（增量缓存）。
- **解决**：`pnpm db:generate` 重新生成 client + 重启后端进程。**经验**：改 schema 后 migrate 只改库，client 类型要单独 generate，且 dev server 需重启才认。

### 2.4 `app.module.ts` 重复 import 同一模块

- **现象**：`TS2300 Duplicate identifier 'ModelModule'`。
- **根因**：分两次编辑时都插入了 import 行。
- **解决**：删除重复行。**经验**：连续编辑同一文件的 import 区后应回读确认，不能只依赖编辑成功的返回。

### 2.5 `listForAdmin()` 返回类型不兼容

- **现象**：`TS2322`，联合类型（secret 分支无 `value`、非 secret 分支 `value: unknown`）不能赋给 `SettingView[]`。
- **根因**：`new Map(...)` 未标注泛型导致 value 推断为 `unknown`；且两个 return 分支形状不一致。
- **解决**：`new Map<string, string>(...)` + 给 `.map()` 回调标注返回类型 `(f): SettingView =>`，让编译器按目标类型收敛。

### 2.6 前端 `api` 无 `put` 方法

- **现象**：`TS2339: Property 'put' does not exist`。
- **根因**：后端设置接口用 `@Put`，但 `api-client.ts` 只暴露了 get/post/patch/delete。
- **解决**：给 api client 补 `put`。

### 2.7 计费记的是员工模型而非实际模型（顺带修）

- **现象**：加了会话级模型覆盖后，`recordUsage()` 仍传 `employee.modelId`。
- **影响**：若会话切到贵模型，会按员工默认模型的价格记账 → **计费失真**。
- **解决**：改传解析后的 `modelId`（会话级优先）。

---

## 三、技术决策与实现要点

| 决策 | 选择 | 理由 |
|---|---|---|
| 模型列表存储 | **实时拉取，不落库不缓存**（用户拍板） | 永远与上游一致，无同步延迟；代价是每次请求有网络往返，用 `staleTime: 5min` 在前端削峰 |
| 配置存储 | **SystemSetting 表 + `.env` 回退** | 库中有值优先用，缺失回退环境变量 → 现有部署零改动平滑迁移 |
| 密钥加密 | **AES-256-GCM**，密钥由 `JWT_SECRET` 经 SHA-256 派生 | GCM 带认证防篡改；复用既有 secret，不新增运维负担 |
| 密文格式 | `enc:v1:<iv>:<authTag>:<ciphertext>` | 带版本前缀 → 可识别明文/密文，支持将来轮换算法 |
| 密钥回传 | **永不回传明文**，只给 `configured: boolean` | 调研文档反复警告的凭据泄漏点；页面用 password 输入框，留空=不修改 |
| 模型切换粒度 | **会话级**（`ConversationSession.modelId`，nullable） | 符合 ChatGPT 心智；单条消息级会让 UI 和消息表都复杂化 |
| 模型优先级 | `session.modelId > employee.modelId > SUB2API_DEFAULT_MODEL` | 三级兜底，任一层缺失都能降级 |

### 关键代码位置

- 实时拉模型：`backend/src/modules/model/model.service.ts` — 10s 超时、上游非 200 抛 `ServiceUnavailableException` 并带中文提示
- 配置读取：`backend/src/modules/setting/setting.service.ts:getEffectiveValue()` — 解密失败时降级回退 env 而非抛错
- 模型解析：`conversation-stream.service.ts:78`
- 切换接口：`PATCH /conversations/:id/model`，传空字符串 = 清除会话覆盖、回退员工默认

---

## 四、今日改动概览（下半场）

### 后端

| 文件 | 改动 |
|---|---|
| `prisma/schema.prisma` | 新增 `SystemSetting` 表；`ConversationSession` 加 `modelId` |
| `common/crypto/secret-cipher.ts` | 新增：AES-256-GCM 加解密 + 脱敏工具 |
| `modules/setting/*` | 新增：Service（读库/回退env/加解密）+ Controller（管理员 GET/PUT）+ Module |
| `modules/model/*` | 新增：实时拉取上游模型 Service + Controller + Module |
| `shared/index.ts` | 新增 `SETTING_KEYS` / `SETTING_FIELDS` / `SECRET_SETTING_KEYS` |
| `conversation.controller/service.ts` | 新增 `switchModel`；`findOne` 带出 `employee.modelId` |
| `conversation-stream.service.ts` | 模型三级优先级；计费改用实际模型 |
| `app.module.ts` | 注册 SettingModule / ModelModule |

### 前端

| 文件 | 改动 |
|---|---|
| `features/model/use-models.ts` | 新增：`useAvailableModels()` |
| `features/chat/model-switcher.tsx` | 新增：对话窗口模型切换下拉 |
| `app/(admin)/admin/settings/page.tsx` | 新增：系统设置页（配渠道 + 测试连接） |
| `features/admin/use-admin.ts` | 新增 `useSettings` / `useUpdateSettings`（保存后同时失效模型缓存） |
| `lib/models.ts` | **删除硬编码数组**，只留 `DEFAULT_MODEL_ID` |
| `app/(admin)/admin/employees/page.tsx` | 模型下拉改用实时数据 + 加载/未配置态 |
| `features/chat/chat-window.tsx` | header 挂载 ModelSwitcher |
| `components/shell/admin-shell.tsx` | 导航加"系统设置" |
| `lib/api-client.ts` | 补 `put` 方法 |
| `lib/types.ts` | `ConversationSession` 加 `modelId`；employee Pick 加 `modelId` |

---

## 五、验证结果

后端全量 `tsc --noEmit` **exit 0**；前端 `tsc --noEmit` 通过；dev server "No errors found"。

接口实测（curl + DB 只读核验）：

| 用例 | 结果 |
|---|---|
| `GET /models/available` | ✅ 返回 **57** 个模型 |
| `GET /settings` | ✅ 非敏感项给明文，`SUB2API_API_KEY` 仅 `configured:true`，**无明文** |
| `PUT /settings` 写默认模型 | ✅ 落库成功 |
| `PUT /settings` 写 API_KEY | ✅ 库中为密文 `enc:v1:6rM8avuxqgiE37rp:...` |
| `PUT /settings` 传空串 | ✅ 记录被删除（回退 `.env`），`COUNT=0` |
| `PATCH /conversations/:id/model` | ✅ 返回 `modelId: claude-sonnet-5`（测后已重置为 NULL） |

---

## 六、遗留 & 下一步

### 追加实现：模型白名单（同日完成）

用户反馈发现两个缺口，当天补齐：

1. ~~用户端不能选模型~~ → 用户端改读「平台已启用模型」
2. ~~缺少可用模型管理~~ → 新增管理端「可用模型」页

**核心问题**：上游 57 个模型里混杂着不该给用户的（`gpt-image-1` 等图像模型、`codex-auto-review` 内部工具、大量 `-preview`/日期后缀重复版本）。直接暴露既混乱又危险（用户选了图像模型去对话会报错）。

**方案**：引入 `PlatformModel` 白名单中间层。

```
上游 57 个 ──[管理员同步]──> 平台库 57 条(默认全禁用)
                              ──[管理员勾选]──> 用户端只看到启用的
```

**关键决策**（与用户讨论后拍板）：

| 议题 | 决定 | 理由 |
|---|---|---|
| 删除 vs 禁用 | **软禁用**（`enabled=false`） | 历史会话/员工仍引用该模型，物理删除会导致历史记录显示不出模型名 |
| 上游模型消失 | **标记 `isStale`，不自动删** | 上游可能临时抖动（某次请求没返回全），自动删太危险；标记后由管理员决定 |
| 新同步入库的模型 | **默认 `enabled=false`** | 避免误开放图像/preview 模型，必须管理员显式启用 |
| 用户端可选范围 | **全局白名单**（方案 A） | 最简够用；将来若按套餐差异化收费再演进到 tier 分级 |

**新增接口**：

| 接口 | 用途 | 权限 |
|---|---|---|
| `GET /models/enabled` | 用户端可选模型 | 登录用户 |
| `GET /models` | 平台全部模型（含禁用/失效） | 管理员 |
| `GET /models/upstream` | 实时看上游全量（测试连接用） | 管理员 |
| `POST /models/sync` | 同步上游 → 白名单 | 管理员 |
| `PATCH /models/:id` | 改启用状态/显示名/排序 | 管理员 |

**安全加固**：`switchModel` 加白名单校验 —— 即使前端被绕过，直接调 API 切到未启用模型也会被拒（400 `模型 X 未开放使用`）。

**实测结果**：

| 用例 | 结果 |
|---|---|
| `POST /models/sync` | ✅ `{upstreamTotal:57, added:57}`，全部默认禁用 |
| 启用 3 个后 `GET /models/enabled` | ✅ 只返回这 3 个 |
| 切到已启用模型 | ✅ 成功 |
| 切到未启用模型 `gpt-image-1` | ✅ 400 拒绝「模型 gpt-image-1 未开放使用」 |
| 上游消失的模型再同步 | ✅ `staled:1`，记录标 `isStale=true` **未被删除** |

**管理端「可用模型」页**：表格列出全部模型（模型ID/显示名/状态/开放开关），带【同步上游模型】按钮、"只看已启用"筛选；失效模型标黄「上游已下架」且开关禁用。

### ⚠️ 连带风险（待处理）

**未配价格的模型会按 0 计费**。`MODEL_PRICING` 只配了 7 个模型的价格，上游有 57 个。一旦启用未配价的模型，`calculateCost()` 返回 `{costUSD:0, costCNY:0}` → **该模型对话完全免费**。

处理方案（择一，待定）：
- 只允许启用已配价格的模型（在 `PATCH /models/:id` 加校验）
- 给未知模型设保底价（取最贵档，宁可多收不漏收）
- 管理端页面对未配价模型显示警示标

### 其他遗留

- 计费 Token 估算误差（上半场遗留）：中文场景 `chars/4` 会低估，待优化。
- `web/src/lib/models.ts` 的 `DEFAULT_MODEL_ID` 与后端仍是两处常量，可考虑由后端下发。
