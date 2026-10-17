# 知识库 Web 端与平台后端重构开发方案 V1

初稿日期：2026-10-15。范围修订：2026-10-16。初稿代码基线：本地工作区 `ea90907`，包含工作区当时已有修改；不是线上部署基线。

状态：目标方案与分批实施记录。2026-10-16 完成第 9.1 节第一批；2026-10-17 已实现第二批文档版本、可靠处理及对应 Web 管理功能，验证边界见文末第二批记录。完整客户端 V1、生产发布及真实模型链路尚未验收。

2026-10-16 用户确认先做平台托管模式，并要求按重新评估的网页管理方案调整文档、开始开发。本次以此更新 Web 范围；客户端仍保留原契约中的全部管理和使用能力。不包含本地知识库、企业内网部署或“只上传向量”的模式。

上位依据：[知识库客户端与平台开发契约及实施方案 V1](../对接/知识库客户端与平台开发契约及实施方案-v1.md)，下文简称“客户端契约”。其中已确认产品边界作为本方案输入，仍待确认的技术默认值不在本文擅自冻结。

本文中的“Web 项目方”包括本仓库的 `web/` 前端与 `backend/` 平台后端；两者职责必须分开。客户端工程不在本仓库，本次不声称已检查其页面、IPC 或运行时实现。

## 1. 重构结论与边界

### 1.1 偏差不是页面少了几个功能，而是产品主线不同

现有主线是：

```text
企业 Web 建库/上传/编辑片段
  -> 将知识库绑定到硅基员工订阅，部分支持部门范围
  -> 平台聊天自动检索并注入参考资料
```

客户端契约要求的主线是：

```text
企业管理员在客户端建库、上传、替换版本、授权企业成员
  -> 平台鉴权、私有存储、异步处理、版本发布
  -> 登录客户端的成员查看/检索已获授权的知识库
  -> 返回可追溯片段，后续运行时接入另立方案
```

因此，本轮不是继续补齐 Web 上的订阅绑定、片段编辑和检索分析，而是将知识库重构为**由企业拥有、按真实成员授权、由客户端消费的平台基础能力**。

这里的企业成员是 `EnterpriseMember`，不是数字员工模板、订阅关系或账号全局角色。知识库创建者也不是知识内容的唯一所有者。

### 1.2 本方案建议的 Web 边界

客户端契约已经确认“用户在客户端完成操作”，不应据此推导出“网页必须退出”。按 2026-10-16 的范围修订，采用以下双入口方案：

- **客户端是主要使用端，保留完整管理能力。** 管理员和普通成员均在客户端使用各自权限内的功能，不强制管理员跳转网页。
- **`backend/` 是知识库能力提供端。** 提供一套统一 API、权限、处理任务、检索和来源服务，不另建客户端专用内容副本。
- **`web/` 保留知识库企业管理入口并重构。** 企业管理员可以建库、上传、查看处理状态、只读预览、管理成员权限和验证检索。第一版不另建普通员工知识工作台或知识问答产品。
- **平台运营端只处理运行健康和配置治理。** 不新增可浏览任意企业知识正文的“超级管理员知识库”；运维角色不自动获得企业内容权限。
- 两端共用一套知识库、文档、成员授权和后端用例，不复制内容，不按端区分权限，不恢复旧订阅绑定。网页不显示普通成员管理入口，直接访问也不得加载管理员数据；这不改变成员在客户端的合法读取权限。

旧的订阅授权、手工片段写入和分析入口退场，知识库管理页面本身不退场。新网页和新后端需协调发布，不能出现“新界面配旧宽权限”或两个入口各自维护权限的双轨状态。

### 1.3 本轮范围

| 必须交付 | 明确不做 |
| --- | --- |
| 库 CRUD、成员授权、权限内列表 | 知识库绑定硅基员工、订阅、部门或模型 |
| 文件上传、文档版本、处理状态、失败重试 | 手工新增/编辑切片、在线编辑源文件 |
| 生效版本只读预览、混合检索、版本化来源 | 用户侧重建索引参数、业务统计大屏 |
| 旧 API 收口、数据迁移、客户端联调 | 原件下载、版本回滚界面、URL 同步 |
| 私有存储、可靠任务、删除与撤权闭环 | OCR、旧 DOC、扫描 PDF、复杂表格重建 |
| Web 企业管理重构、旧绑定收口与非目标功能回归 | 何时触发检索、问题生成、上下文注入与自动编排 |

文件格式/大小以服务端 `limits` 为准。文本 PDF、DOCX、UTF-8 TXT/Markdown、10 MiB 是客户端契约的建议起点，不是当前实现的能力承诺。

## 2. 现状核对与改造判断

本节是 2026-10-15 的本地静态观察，不代表真实 PostgreSQL、Redis、embedding 或生产流程可用。旧调研文档只能作为定位线索，不能把其中“完善部门授权、下载、Rerank 页面”等建议直接加入本轮。

| 区域 | 当前代码事实 | 本轮处理 |
| --- | --- | --- |
| Web 页面 | `/knowledge`、`/knowledge/[id]`、`/knowledge/[id]/analytics` 及侧栏入口已存在 | 保留列表/详情管理入口；旧分析 URL 重定向，管理员边界受控 |
| 知识库详情 | 文档、文本片段、状态、授权等旧管理能力集中在详情页 | 改为文档、成员权限、检索验证、基本设置；只读预览替代片段编辑 |
| Web hooks | 知识库、文档、切片、授权、测试分别有 hooks；有两套知识库相关入口文件 | 完成引用清单后再清理，不能仅删一个页面文件 |
| 授权对象 | 旧知识授权围绕订阅/部门，不是当前登录成员 | 新增独立成员授权语义，旧授权不直接翻译 |
| 文档 API | 上传为 `POST /knowledge-bases/:kbId/documents/upload`；存在下载、重试等旧入口 | 新集合上传、版本、预览与重试契约替换；关闭不在 V1 的旁路 |
| 检索 API | 旧搜索依赖 `subscriptionId`；另有管理测试检索 | 统一为当前成员访问范围，不保留订阅参数作为知识权限依据 |
| 内容处理 | 已有 parser、chunker、embedding、vector、词法与 BullMQ 基础 | 保留经过验证的算法/适配器，重构状态、版本、发布与恢复编排 |
| 数据模型 | 现有模型不是不可变原件版本、成员授权、发布代次的完整模型 | 先增量建模、迁移演练，再切业务读写 |
| 浏览器网络层 | `api-client.ts` 普通 JSON 请求返回 body；`uploadForm()` 是另一条路径 | 按新接口增量支持必要响应头、幂等上传与刷新重放，不重写全站客户端 |
| 通用错误层 | 普通 API 保留 `statusCode/message/requestId/timestamp/path`；知识库稳定错误码尚需落实 | 增补知识库顶层 `code`，不改成模型网关错误形状 |

### 2.1 可以保留什么

- NestJS 知识库模块、PrismaService、企业成员上下文、PostgreSQL/pgvector、Redis/BullMQ 的既有技术栈。
- 经过格式样本验证的解析逻辑、词法/向量检索实现、基础队列封装和相关单测；“已有实现”不等于无需修改即可复用。
- 与知识库无关的订阅、数字员工授权、组织成员管理、聊天、认证刷新和既有 SSE 协议。
- Web 中真正通用的 UI/网络组件。管理页面重构不顺手重构全局设计系统或全站认证。

### 2.2 不能保留的旧产品假设

1. 同企业就可以读取全部知识库。
2. 订阅了某硅基员工，就自然拥有其绑定知识库的内容权限。
3. 部门主管自然可以管理知识库。
4. 最新上传失败就意味着旧内容也不可用。
5. 将文本切出来就算 READY，embedding 失败可不影响入库完成。
6. 从前端隐藏按钮就能完成授权、撤权或功能关闭。
7. 用当前正文替换历史引用正文，仍可声称来源可追溯。

## 3. 目标架构与责任划分

```text
客户端页面 / preload / 主进程 service、data
  -> /api + 平台 JWT
  -> 当前有效 EnterpriseMember 上下文
  -> KnowledgeAccessPolicy
  -> 库 / 成员授权 / 文档版本 / 预览 / 检索 / 来源
  -> Prisma + PostgreSQL/pgvector
  -> 私有原件存储
  -> DB 作业与 outbox -> Redis/BullMQ -> 独立 worker

Web 管理页面 -> 同一 API / 企业成员策略 / 同一知识库数据
平台运维：任务/容量/故障监控；不默认读取企业正文
```

| 责任方 | 交付责任 | 禁止承担的职责 |
| --- | --- | --- |
| Web 前端 | 管理列表、文档/状态/预览、成员授权、检索验证、设置；旧绑定收口与正常业务回归 | 不另存索引、不自行决定权限、不另建普通员工问答工作台 |
| 平台后端 | 18 项目标路由操作、共享 schema、鉴权、存储处理、检索来源、兼容治理 | 不信任客户端上报企业/角色/授权范围，不直连模型上游 |
| 客户端 | 页面与 IPC、主进程持有令牌、上传交互、轮询、冲突与引用展示 | 不自行切片/向量化，不依赖隐藏按钮做安全 |
| 运维 | pgvector、私有持久化、worker、资源限制、备份恢复、监控 | 不把 Redis 队列当唯一任务记录，不公开知识原件目录 |
| 联合测试 | 两企业两角色、版本/故障/撤权/迁移验收证据 | 不以 mock 单测或页面截图替代真实处理验收 |

不新增独立 Gateway 或新的向量数据库。知识库继续位于现有 NestJS 应用；worker 可有独立启动入口，但共享平台业务模块与配置。

## 4. 平台后端改造设计

### 4.1 企业成员上下文与唯一权限策略

复用 `backend/src/modules/enterprise/enterprise-context.service.ts`，每次请求从已验证用户解析有效 `{userId, enterpriseId, memberId, enterpriseRole}`。不接受调用者传 `enterpriseId`、`role`、`userId` 来确定访问范围。

建议在知识库模块内新增 `KnowledgeAccessPolicy`，而非把判断散落在 controller、下载和搜索代码里：

| 策略能力 | 使用位置 |
| --- | --- |
| 要求本企业有效成员 | 所有知识库操作，包括幂等结果回放 |
| 要求企业管理员 | 创建/修改/删除、上传/替换/重试、授权候选及授权管理 |
| 校验单库可读 | 详情、文档、预览、来源 |
| 校验显式多库范围 | 显式 `knowledgeBaseIds` 检索，任一无权即整次 404 |
| 构造可访问范围 SQL 条件 | 列表、未指定范围检索，不能只查当前列表页 |

管理员仅隐式访问本企业；其他企业角色在本模块均按普通员工处理。普通员工必须有有效显式成员 grant。没有有效企业成员关系返回 403；普通员工调用管理员操作返回 403；可读类请求中不存在、跨企业、未授权统一 404。

权限过滤必须进入召回查询，且响应提交前校验权限/删除/发布状态。撤权成功后新进入的请求不能命中旧权限缓存；初期优先不缓存敏感搜索结果和成员权限。

### 4.2 增量数据模型

以下是目标对象，不表示当前 Prisma 已具有这些字段。先用工具生成新增迁移，不原地把旧订阅授权表改成另一种含义。

| 对象 | 改造重点 |
| --- | --- |
| `KnowledgeBase` | 企业所有权、`revision`、`deletedAt`、创建者审计快照 |
| 成员授权关系 | `(knowledgeBaseId, memberId)` 唯一，企业归属一致，授权人可空引用和安全姓名快照 |
| `KnowledgeDocument` | 稳定显示名、`revision`、`activeVersionId`、`latestVersionId`、软删除 |
| 文档版本 | 不可变原件 key/hash/文件名/MIME/大小、递增版本号、处理状态/阶段/安全错误 |
| 处理作业与 outbox | `versionId/indexGeneration`、租约、fencing token、尝试记录、可恢复调度 |
| 解析块与切片 | 版本/代次、确定顺序、token 数、真实页码/章节/块范围、稳定 `sourceId` |
| Embedding profile 与发布记录 | 固定模型修订/维度/tokenizer/距离函数，记录完整代次发布与历史保留 |
| 幂等与审计 | 请求摘要、状态/租约、结果引用；默认不记录正文与完整问题 |

建议新增 `KnowledgeMemberGrant` / `knowledge_member_grants` 与旧 `KnowledgeGrant` 并存迁移，外部 DTO 仍按客户端契约命名；最终物理命名在 schema 评审确定。不得把 `subscriptionId` 填进 `memberId` 或凭“订阅可由哪些成员使用”自动扩权。

IDs 采用项目既有 cuid，新增表 `@@map` 为 snake_case 复数，保留审计时间。企业归属用组合约束或事务校验保证，不能只信关联 include 的偶然结果。有效管理员降权后只保留仍有效的显式授权；离职成员授权失效，新 `memberId` 不继承旧记录。

### 4.3 文档版本、私有存储与发布

首次上传和指定文档替换是两种不同操作：

- 普通上传总是新文档，同名不覆盖。
- 替换必须指定 `docId` 和当前 `expectedRevision`；同文档最多一个在途版本。
- 平台计算 SHA-256；与当前 active 原件相同返回 200、`unchanged=true`，不新建版本或处理。
- 文档显示名默认保持首次文件名；各版本保存自己的 `originalFilename`。
- v1 已生效、v2 在途或失败时，`activeVersion=v1`、`latestVersion=v2`、`searchable=true`。
- 原件可靠存储，版本/作业/outbox/幂等结果事务落库后才返回 202；202 不是可检索承诺。

私有原件存储通过受控 adapter 读写，不向客户端返回 `filePath/objectKey`。先校验身份、角色和额度，再接收并校验文件大小、格式特征与哈希。解析器的压缩解包、内存、耗时与外部资源访问必须受限。

删除先在事务中标记不可见、登记清理 outbox，再异步回收原件和索引；处理中也允许删除。旧任务必须检查 tombstone、当前代次和租约，不得在删除后发布或复活内容。

### 4.4 可靠处理链

```text
PENDING / QUEUED
  -> outbox 投递 -> worker 领取当前代次租约
  -> PROCESSING / PARSING -> CHUNKING -> EMBEDDING -> PUBLISHING
  -> 事务检查并切换 active 指针 -> READY / DONE

失败 -> FAILED + 安全错误；旧 active 保持不变
人工重试 -> 同版本、新处理代次，不改写原件
```

必须改造“以可变 docId 直接重建当前数据”的处理方式。首次处理、失败重试统一走版本作业；不允许 HTTP 请求中直接启动另一套 processor，也不允许在新索引就绪前删除旧生效切片。

原子发布前同时验证：当前任务/租约有效、版本仍为最新、资源未删除、解析和词法/向量数据完整、profile 一致。embedding 失败不能将首次入库标为 READY。自动重试须有限、分类且尊重等待时间；确定性格式错误不提供无效重试。

worker 重启、Redis 暂时不可用、重复投递、过期任务都必须由 DB 作业/outbox/代次处理，而不是只靠 BullMQ jobId。进度使用真实阶段和计数，总切片数未知时返回 null。

### 4.5 解析、预览与 embedding

- parser 输出结构化块，不先压成失去定位的一行全文。PDF 页码必须来自真实页；DOCX/TXT/Markdown 没有可靠页码时返回 null。
- 先验证当前 PDF 解析调用与锁定依赖 API；不把旧 DOC 分派给 DOCX 解析器，不在本轮开放图片 OCR。
- 清理不能误删数字型号、金额、年份；切片保留块范围与章节，使用真实 tokenizer 做预算。
- 预览只返回当前 active 的结构化纯文本块，不返回未净化 HTML 或公开原件地址。翻页携带首屏 `versionId`，切版冲突后从第一页刷新。
- embedding profile 固定模型修订、维度、tokenizer、距离函数；入库与查询使用兼容 profile，返回向量需校验数量、顺序、维度和有限值。
- **遵守项目统一模型出口。** 客户端契约偏好的本地/私有 BGE 部署不等于允许应用绕过 sub2api。embedding 能否经 sub2api 使用目标 profile 必须实测；不支持时记录为交付阻塞项，不临时从应用直连上游。不得把当前代码默认端点当生产批准配置。
- 首批格式只有真实样本通过后才能进入 `limits.allowedExtensions`。tokenizer、parser 与 profile 选型优先复用已有依赖，确有缺口再单独评审，不因本方案自动安装依赖。

### 4.6 检索与来源

检索只接受 `query`、可选 `knowledgeBaseIds` 和 `topK`，不接受订阅、数字员工、模型、相似度阈值或客户端上报权限。

向量与词法两条查询均限定当前企业、有效成员授权、未删除库/文档、active 版本及已发布代次。优先复用既有混合检索思路，但去掉订阅授权前提、共享可变词法状态和不符合过滤语义的召回方式。

| 结果 | 正确语义 |
| --- | --- |
| `MATCHED` | 有有效来源；`count` 等于实际结果数，不强凑 topK |
| `NO_MATCH` | 真正执行检索但无匹配，不代替异常 |
| `NO_ACCESS` | 仅未指定范围且当前成员没有任何可访问库 |
| `NOT_READY` | 有可访问库但没有生效可检索文档，不代替依赖故障 |
| `partial=true` | 实际检索范围仍有文档没有 active；新版本失败但有旧 active 不算缺失 |
| `degraded=true` | 仅 query embedding 暂不可用时显式降级词法；词法也失败则 503 |

来源接口每次重新鉴权，精确返回命中时的 `versionId/chunkId/location`。仍保留的曾发布版本可返回 `isCurrent=false`；未发布版本不得读取。撤权、删除、保留期结束后统一 404，不能用当前版本正文替换旧片段。

本轮交付检索服务及来源，不顺带设计客户端自动检索或模型上下文拼接。

## 5. 客户端接口交付清单

完整字段、校验、错误码和样例以客户端契约第 4～7 章为准；下表用于平台排期。路径均省略既有 `/api`，不新增 `/v1` 或 `{success,data}` 外层。

`K = /knowledge-bases/{kbId}`，`D = K/documents/{docId}`。

| 编号 | 方法与路径 | 平台改造/交付 |
| --- | --- | --- |
| 01 | `GET /knowledge-bases` | 成员过滤、分页、`viewer/capabilities/limits`，空列表也必返 |
| 02 | `GET K` | 权限内详情、revision、强 ETag |
| 03 | `POST /knowledge-bases` | 管理员创建，幂等，201 + Location |
| 04 | `PATCH K` | 仅元数据，If-Match，返回新 ETag |
| 05 | `DELETE K` | If-Match，立即不可见，204 |
| 06 | `GET K/documents` | 分页、最新状态筛选、active/latest 双版本语义 |
| 07 | `GET D` | 安全处理进度、权限、revision 与 ETag，支持轮询 |
| 08 | `POST K/documents` | 单文件新上传，幂等，可靠接受后 202 |
| 09 | `POST D/versions` | 指定替换、expectedRevision、哈希去重，202 或 unchanged 的 200 |
| 10 | `DELETE D` | If-Match，软删除与清理 outbox，204 |
| 11 | `GET D/preview` | 生效版本块分页与翻页一致性 |
| 12 | `POST D/reprocess` | 最新可重试失败版本，幂等及 expectedRevision，202 |
| 13 | `GET /enterprise/members?view=knowledge-grant` | 管理员专用安全投影、分页搜索，旧无 view 请求不变 |
| 14 | `GET K/grants` | 仅管理员，成员显式授权分页 |
| 15 | `POST K/grants` | 1～100 个有效 memberId，整批校验、事务写入、唯一去重 |
| 16 | `DELETE K/grants/{memberId}` | 撤权并失效后续访问，204 |
| 17 | `POST /knowledge-bases/search` | 当前成员范围、状态/降级/partial、稳定来源 |
| 18 | `GET K/sources/{sourceId}` | 版本化来源、当前权限与历史保留校验 |

### 5.1 横向契约必须一起实现

1. 共享 Zod schema/DTO 作为唯一业务校验来源，通过项目既有 `shared` alias 使用；新增导出落在 `backend/src/shared/index.ts`。不在客户端和 Web 各手抄一套校验规则。
2. controller 只负责 HTTP、认证接入和 Swagger，业务编排放 service；所有数据访问经注入的 PrismaService。每个新接口提供对应 OpenAPI 响应与错误说明。
3. `revision` 是资源修订，不是文件版本。详情强 ETag 必须覆盖实际响应表示；If-Match 与事务写入绑定，不能用更新时间或列表 revision 拼造。
4. 创建、上传、替换和重试实现持久化幂等；同键同参回放前重新鉴权，超时重试复用旧键，冲突不静默覆盖。
5. 知识库错误顶层增补稳定 `code`，保留普通 API 既有封装，不将内部路径、堆栈、上游原响应暴露给调用端。
6. 知识内容与权限响应 `Cache-Control: no-store`；201/202 的 Location、ETag、Retry-After 和请求 ID 必须穿过部署代理。204 不带 JSON。
7. `/knowledge-bases/search` 作为静态路由不能被动态 kbId 路由截获；库/文档/来源必须验证 URL 父子归属。
8. 上传、检索、成员搜索具有企业级/成员级限流；并发上传的存储额度预留必须原子化，不能只由客户端检查。

### 5.2 浏览器基础设施的处理边界

现有 `web/src/lib/api-client.ts` 的 JSON API 会返回 body，无法直接供调用者读取 ETag；multipart 上传 helper 也没有完整的幂等请求头和一次刷新重试选项。这是 Web 调用新知识库 API 时的接入差距，不是本轮大改全站网络层的理由。

浏览器适配新契约时应增量提供“body + 必要响应头”和安全 multipart 能力，保持旧调用默认返回形状不变；401 仅重放一次、保留原幂等键，403/404 不重试。不得把 Electron“令牌只在主进程”的约束搬成浏览器 localStorage 方案；Web 仍保持 access token 仅内存、refresh cookie httpOnly。第一批尚无版本/幂等契约时不伪造 ETag 或幂等成功。

当前 Web 通过 Next rewrite 同源转发 `/api`；只有出现经批准的跨域浏览器调用时才增量配置必要 CORS 暴露头，不泛化放开来源。V1 客户端原生主进程 HTTP 接入不能因为 Web 网络 helper 未升级而阻塞。

### 5.3 生产客户端写请求与 CSRF 前置条件

`backend/src/modules/security/guards/csrf.guard.ts` 当前在生产模式要求一般写请求具有获准 Origin/Referer；精确豁免了部分桌面认证端点和模型网关聊天端点，但没有知识库写接口。因此“主进程持 Bearer 即可上传”在当前生产模式不能直接视为成立。

契约冻结阶段必须测试真实客户端主进程请求，确定并实现最小兼容策略。若需要让原生 Bearer 请求不依赖浏览器来源，应仅对明确列出的、独立 JWT 鉴权且不依赖 Cookie 身份的知识库写路由做受控适配，保留后续 JWT/成员/对象策略与限流；未知路由仍执行既有保护。不全局关闭 CSRF、不宽泛豁免 `/api/*`，也不让调用者伪造一个 Origin 充当身份认证。Cookie 认证/刷新语义维持现状。

## 6. Web 企业管理前端重构

保留 `/knowledge` 管理入口，面向企业管理员；普通成员主要在客户端使用，不另建网页知识工作台。网页入口按企业角色控制，不按全局 `user.role` 推断，后端对每次调用独立检查权限。普通成员直接访问网页管理路由时显示受限状态，不能先拉授权名单再隐藏。

### 6.1 页面与交互

| 页面/区域 | 目标设计 |
| --- | --- |
| 知识库列表 | 紧凑表格，名称/说明、文档数、成员授权数、更新时间；搜索、分页、新建、编辑、删除；不再使用“为硅基员工绑定知识”的文案 |
| 详情：文档 | 上传与列表同页；列出文件名、大小、处理状态、更新时间、可用操作；按状态筛选；失败重试，处理期间自动轮询，不另开重复状态页 |
| 文档预览 | 抽屉或对话框内只读展示已处理文本；分页和错误/处理中状态明确；不提供原件下载或片段编辑，不编造页码/版本来源 |
| 详情：成员权限 | 已授权真实企业成员名单、授权时间；分页搜索成员，支持一次选择多人授权和撤销；不选择硅基员工/订阅/部门 |
| 详情：检索验证 | 输入问题，展示命中正文和来源；不提供阈值、Rerank 等参数，不把相关分数写成准确率；不是聊天产品 |
| 详情：基本设置 | 名称、说明、删除；破坏性动作确认和错误反馈 |
| 旧分析 URL | 重定向同一知识库详情；不维持第二套内容分析 API |

网页与客户端共用权限：管理员隐式拥有企业全部知识库权限，成员授权只授予读取/检索，不因勾选授权获得管理权。空列表仍能判断管理员创建能力；网络失败、403、404、无数据分别处理。桌面/窄屏均不得出现操作遮挡和页面横向溢出。

后端返回的 `limits` 决定上传格式和大小。上传成功只表示文件已接收，不能显示“知识已可用”；处理成功才可检索。有失败文件时保留结果，避免整体关闭上传框掩盖失败。完整版本能力完成前不展示不可用的“上传新版本”按钮。

### 6.2 文件级处置清单

| 文件/目录 | 实施动作 | 必须保留的边界 |
| --- | --- | --- |
| `web/src/components/shell/enterprise-shell.tsx` | 保留知识库导航/面包屑，按企业管理员角色显示 | 不影响技能库、雇佣管理、工作台导航 |
| `web/src/app/(enterprise)/knowledge/page.tsx` | 列表/搜索/分页/CRUD，使用后端能力和限制 | 不以普通成员身份加载管理内容 |
| `web/src/app/(enterprise)/knowledge/[id]/page.tsx` | 文档、成员权限、检索验证、设置；移除片段编辑 | 只有当前选中区域加载相应数据，不提前请求授权名单 |
| `web/src/app/(enterprise)/knowledge/[id]/analytics/page.tsx` | 重定向详情，停止旧统计调用 | 健康监控不在此另建一套企业内容分析 |
| `web/src/features/knowledge/` | 改造现有 hooks/组件、统一 query keys 与权限失效处理 | 不继续调用旧订阅授权、手工片段写入和下载接口 |
| `web/src/features/enterprise/grant-panel.tsx` | 仅移除知识库 Tab、候选查询和绑定操作 | 保留硅基员工成员/部门使用授权和失效时间 |
| `web/src/app/(enterprise)/subscriptions/page.tsx` | 检查 GrantPanel 接口与标签变化 | 保留订阅购买、暂停/恢复、成员授权、申请审批 |
| `web/src/features/enterprise-settings/model-config-form.tsx` | 退出知识库 embedding/Rerank 用户配置入口 | 保留会话、员工、编排模型设置及共用表单 |
| `web/src/lib/types.ts` | 区分旧知识库业务类型、新目标契约与历史消息来源类型；按引用删除废弃项 | 不能直接用新 `KnowledgeSource` 覆盖旧消息同名类型 |
| `web/src/features/chat/message-bubble.tsx`、`chat-window.tsx` | 保留历史消息来源展示；不新增检索/当前正文兜底请求 | 不把旧 score 展示当新接口概率语义 |
| `web/src/features/enterprise/use-enterprise.ts` | 保留旧组织/员工授权调用契约 | 无 view 成员列表仍为原响应，不切成知识投影 |
| 角色/API key 权限展示、permission matrix | 审查 `knowledge:*`、`knowledge:read` 的旧文案和用途，不再作为知识授权控制入口 | 不批量删除通用权限系统；旧 scope 不得绕过成员策略 |
| `web/src/lib/api-client.ts`、通用 upload/download | 按新契约需要增量适配，保留其他消费者 | 不改认证存储或放宽全站重试行为 |

列表/详情原 URL 保持有效，旧分析书签回到详情。旧片段组件停止被生产入口引用，确认引用清零后再清理；不擅自物理删除旧表、历史消息或文件。

### 6.3 成员授权与硅基员工授权不能混淆

| 关系 | 对象与用途 | 本次是否改变 |
| --- | --- | --- |
| `EmployeeGrant` | 成员/部门能否使用某个订阅硅基员工，可含失效时间 | 保留原业务，不迁为知识 grant |
| 旧 `KnowledgeGrant` | 知识库与订阅/部门绑定 | 停止作为知识权限依据，迁移期保留审计数据 |
| 新知识成员 grant | 指定企业成员查看和检索整个知识库，含未来文档 | 本轮新增，固定只读/检索，不授予管理员身份 |

知识授权候选使用新增 `view=knowledge-grant` 投影。组织页不传 view 时仍返回原有成员结构；不得借知识库“两角色”规则删除全站部门主管角色或改写员工授权模型。

### 6.4 缓存与历史引用

- Web 退出登录、企业身份变化、失去管理资格时取消知识库相关在途 Query，并移除本模块内容缓存；如无现成统一 key，应按已枚举的知识专用 key 精确处理，不能清空全站 Query 造成无关业务回归。
- 服务端 `no-store` 不会自动清除浏览器内存 Query。客户端同样需要在退出、身份变化、撤权/404 后停止轮询并清理本模块缓存。
- 当前聊天来源是消息中保存的正文快照，并不是 V1 版本化来源接口。旧消息继续按消息/会话访问规则展示；新 DTO 应采用明确命名或显式适配避免混用。
- 撤权不能远程销毁已经交付的正文。历史消息/审计保留策略需另行记录，不在本次未经授权批量改写或删除历史会话。

## 7. 旧接口与旧聊天链路收口

当前知识 Controller 中可识别 26 项路由操作；目标契约为 18 项（包含复用的企业成员投影）。这不是一对一换路径，必须逐路由决定保留、替换或关闭。

### 7.1 旧 API 处置表

下表的“关闭”指服务端直接请求也不能读写，并有固定失败响应和零副作用测试；一般已登录调用者可采用 410 退场提示，资源可见性相关响应仍遵守 403/404 防探测规则，具体路由策略在接口清单中固定。

| 旧能力/路径 | V1 处置 |
| --- | --- |
| 库 CRUD、文档列表/详情/删除 | 同路径升级为新 schema、成员权限、版本与并发语义；不能保留同企业即读旁路 |
| `GET/POST K/grants` | 同路径替换成成员 grant；严格拒绝旧 `subscriptionId/departmentId`，不静默忽略 |
| `GET /knowledge-bases/grants/by-subscription/{id}` | 关闭；不再给订阅查知识范围 |
| `DELETE /knowledge-bases/grants/{grantId}` | 关闭；改用库内 memberId 撤权路由 |
| `POST K/documents/upload` | 默认关闭；若必须短期保留，仅能适配新上传用例及全部权限/幂等约束，有下线日期 |
| `POST D/reprocess` | 路径保留但严格升级 payload 与版本作业；旧空 body 不能再启动直接 processor |
| `GET D/download` | 关闭，不以修复带 token 下载代替新只读预览 |
| `GET/POST K/chunks` 与单 chunk 的 GET/PATCH/DELETE | 五项全部退出外部业务接口；不把手工片段写入口保留成索引旁路 |
| `POST K/reindex` | 从企业用户 API 关闭；运维确需重建应走受控内部任务，不绕开版本发布 |
| `POST K/test-search` | 关闭；检索服务调试不另设弱鉴权公共入口 |
| `GET K/documents/status` | 由新文档列表/详情替代；临时适配也必须新策略且不得回传内部任务信息 |
| `POST K/documents/batch-reprocess` | 关闭，不继续维持绕开版本任务的批处理重试 |
| `GET K/analytics` | 退出 V1 用户 API；基础运维指标另按脱敏监控处理 |
| `POST /knowledge-bases/search` | 同路径破坏性升级：严格拒绝 subscriptionId、旧阈值等字段，使用成员范围 |

旧 CLI/SDK/API key 调用方与客户端旧适配器也必须纳入清单，不能只搜索 Web 页面。全局 PermissionGuard/API key scope 不得替代知识内容策略或授予跨企业特权。

### 7.2 Web 聊天旧 RAG 的退场

当前实际入口在 `backend/src/modules/conversation/conversation-stream.service.ts`：有订阅和文本时调用 `knowledgeSearch.search(content, userId, subscriptionId, ...)`，拼接知识上下文，并把来源正文快照写入消息。这里传了 `userId`，问题不是“缺失用户身份”，而是依赖旧订阅知识授权的产品语义。

本方案建议：与旧绑定退场同步停止这段自动知识检索、知识上下文注入和新来源快照写入，保留普通聊天、历史消息、模型调用、预算/超时、工具、附件和 SSE。不要为了关闭 RAG 整体删除 KnowledgeModule；聊天附件上下文仍复用其中解析能力。

第一批兼容阶段如尚未完成聊天退出切换，旧内部检索必须同时满足员工使用资格和当前成员知识权限；旧订阅/部门知识绑定不得扩大成员可读范围。兼容阶段不是最终 runtime 方案，也不新增自动检索触发规则。

未来若重新接入客户端或 Web runtime，先评审调用身份、触发时机与数据外发，再复用当前成员知识策略；不能直接调用无鉴权的 `searchByKnowledgeBase()` 或依赖数字员工订阅获得资料权限。

### 7.3 必须保护的聊天使用权边界

静态检查发现，当前 `SubscriptionService.assertActiveSubscription()` 校验企业订阅有效性，并不等同于完整的成员/部门 `EmployeeGrant` 校验；旧 RAG 过程中有另一段员工授权判断，但检索失败会被聊天链路捕获。**不能把这段 RAG 当成正常聊天使用权闸门，也不能宣称移除 RAG 后授权自然正确。**

在关闭旧 RAG 的变更中，必须增加“建会话、每轮续聊、切换目标员工”的员工使用权回归。若确认缺少执行层校验，应复用现有员工访问策略补齐或以独立前置修复交付，不扩大成全站授权系统重构。验收包含授权过期、撤权、调岗、订阅失效后不可继续使用；知识成员 grant 的增删不应改变这些结果。

## 8. 数据迁移、灰度与回退

### 8.1 数据分类，不自动扩权

| 存量数据 | 迁移原则 |
| --- | --- |
| 企业归属明确的知识库 | 保留 ID 与企业归属，补 revision/删除状态；管理员仅本企业可见 |
| 原件存在且来源合法的文档 | 建立首个不可变版本；重新处理并验证后才发布 active，不直接信旧 READY |
| 原件缺失/路径失效文档 | 隔离并出具安全错误/迁移报告，等待管理员重新上传；不伪造成功版本 |
| 手工创建片段、无法绑定合法原件的切片 | 隔离、不进入新检索；确需保留由管理员在网页或客户端上传文件 |
| 旧订阅/部门知识授权 | 留存审计，不自动翻译为成员权限；由管理员在网页或客户端重新授权 |
| 旧向量、词法索引 | 不直接混入新发布代次；按固定 profile 重建并通过后切换 |
| 历史消息来源快照 | 不伪造 versionId/sourceId，不批量改写会话；沿既有会话权限和留存策略 |

### 8.2 推荐发布顺序

1. **准备与演练。** 输出旧调用方/路由清单，备份 DB 与原件，对测试副本分类迁移，生成按企业汇总的数量和权限差异报告；日志不包含正文。
2. **增量部署。** 新表/约束、策略、版本 worker 与新契约先部署但不开客户端入口。旧知识访问如不能立刻满足成员策略，先关闭相关功能；不得以“还没迁移”为由持续开放宽权限读取。
3. **受控迁移。** 对确定来源文档建版本并重处理，核对失败/隔离清单；新库默认无普通成员授权，管理员通过网页或客户端显式授予。
4. **同步切换。** 网页切换新管理界面，停止旧订阅绑定，收口旁路/旧聊天 RAG，再开放确认契约的客户端。相同路径的破坏性 schema 不能按同一全局账号随机灰度，须按企业开关、协调版本或维护窗口切换。
5. **灰度验收。** 先测试企业后小批真实企业；确认两角色、两企业、撤权/删除、新旧版本与故障恢复。无证据不扩大。
6. **清理。** 调用量归零且过观察期后另做旧代码/旧索引清理。物理删除旧表和备份须单独授权，不和 API 切换绑定。

灰度开关是服务端受控开关，不是浏览器隐藏按钮；未开通企业的直连写入/检索也不能绕过。优先复用已有开关设施；没有时使用最小受控配置，不为这次迁移新建通用开关平台。

### 8.3 回退底线

- 优先关闭知识库入口/新写入，保留普通聊天和其他企业业务；修复后继续消费可恢复作业。
- 不回退到“同企业全量可读”、订阅知识绑定或无成员授权的旧搜索，不能以恢复页面为由扩大权限。
- 增量 schema 保持可用，不执行破坏性 down migration。发布前演练旧应用对新增 schema 的兼容性，不能假设回滚二进制即可恢复。
- 已发生的新版本/授权/删除必须保留审计与恢复依据，删除 tombstone 不能回退成可见。需要恢复数据时另走获批恢复流程。

## 9. 开发拆分与完成标准

任务按依赖组织，不用未经评估的工期或“完成百分比”掩盖真实处理风险。2026-10-16 开始第一批基础和网页管理开发；各项实际结果见实施记录，未列出证据的阶段不视为完成。

| 阶段 | 主要任务与代码位置 | 依赖 | 完成标准 |
| --- | --- | --- | --- |
| A. 契约/存量冻结 | 本文与客户端契约评审；`shared/knowledge*.ts`；旧调用方及 CSRF 样例验证 | 无 | 18 项 schema/OpenAPI、错误码、样例、默认值状态和旧 API 处置表一致 |
| B. 权限/数据基础 | Prisma 新模型、`KnowledgeAccessPolicy`、库 CRUD、成员投影/授权 | A | 两角色两企业、空列表、离职/降权/撤权、旧读取旁路测试通过 |
| C. 版本/可靠处理 | 私有存储、版本、幂等/outbox、worker、解析块、真实 tokenizer、embedding profile/统一出口、原子发布 | B | 首批格式实测，旧 active 不受失败新版本影响，重启/队列故障可恢复 |
| D. 检索/预览/来源 | `knowledge-search`、`vector`、`lexical-search`、解析预览和来源服务 | C | SQL 权限和发布代次过滤、四状态/降级/partial、旧来源准确性及撤权验证 |
| E. Web 管理与旧链路收口 | 第 6 章四区域管理页面、同一权限与接口、第 7 章旧能力收口 | B，可与 C/D 并行 | 文档/成员授权/检索验证闭环、普通成员受限、旧片段/绑定请求为零，普通业务/附件/SSE 保持 |
| F. 迁移与客户端联调 | 工具生成迁移、测试副本演练、客户端主进程真实文件链路、监控/恢复说明 | B～E | 迁移报告、真实验收证据、回退演练、客户端与平台共同放行 |

建议分成可审查的独立提交：契约与测试、数据与权限、可靠文档链、检索来源、Web/旧 API 收口、迁移与验收。实际提交仅在用户要求时执行。

### 9.1 首批可运行范围与过渡接口

首批优先落地成员授权/统一访问策略、网页四区域管理、旧绑定清理和自动化回归。保留旧授权表但停止作为内容访问依据；不自动授予成员任何旧库权限，不连接或修改生产数据库。

| 首批交付 | 后续阶段，不能宣称已完成 |
| --- | --- |
| 知识库列表分页、成员可见范围、企业角色/创建能力、实际上传限制 | 详情强 ETag/If-Match、持久化幂等、原子配额 |
| 独立成员授权表、批量授权和撤权、授权候选专用投影 | 存量权限人工确认及全量生产迁移 |
| 网页文档列表/处理状态合并、失败重试、只读处理文本预览 | 不可变版本、上传新版本、原子 active 发布、版本化来源 |
| 统一成员访问策略约束现有检索、关闭片段写入与原件下载等旁路 | 完整搜索四状态/降级协议、累计结果 token 预算、真实模型/故障/性能验收 |

过渡期 `POST K/documents/upload`、`GET K/documents/status`、`POST D/reprocess` 与 `POST K/test-search` 可作为网页适配继续存在，但必须使用统一策略和严格 DTO。文档列表/详情暂用现有文档模型；预览展示已有处理文本，不伪造 `versionId`、页码或生效版本承诺。最终与第 5、7 章的目标契约统一，在客户端联调前提供差异清单和切换窗口。前端不展示尚未交付的新版本/回滚功能，不把上传接收成功等同索引就绪。首批 `limits.maxResultTokens=6000` 仍为目标声明，尚无统一累计输出 token 限制，不作为本批已兑现的能力或客户端安全预算。

### 9.2 后端文件级任务

| 文件/模块 | 具体任务 |
| --- | --- |
| `backend/prisma/schema.prisma` 与新迁移 | 新成员授权、版本/代次/任务/发布/幂等及约束，迁移工具生成 |
| `backend/src/shared/knowledge.dto.ts`、`knowledge-search.dto.ts`、`index.ts` | strict 新输入与输出、成员投影、稳定错误码；清理旧导出须核对所有消费者 |
| `knowledge.controller.ts`、`knowledge.service.ts` | 成员策略、分页元信息、修订/ETag、旧授权退休 |
| `document.controller.ts`、`document.service.ts` | 集合上传、版本、预览、并发与幂等、204/202、私有存储；关闭下载旁路 |
| `document-processor.service.ts`、`knowledge-queue.service.ts` | 版本化任务、outbox/租约/代次、统一重试、原子发布；独立 worker 入口 |
| `document-parser.service.ts`、`text-chunker.util.ts`、`text-tokenizer.service.ts` | 真实格式验证、结构块定位、模型 tokenizer；保留词法分词与预算分词的职责差异 |
| `embedding.service.ts`、`vector.service.ts`、`lexical-search.service.ts` | 统一出口、固定 profile、输出校验、SQL 授权/active 过滤、并发词法状态隔离 |
| `search.controller.ts`、`knowledge-search.service.ts` | 新检索 schema、状态/预算/降级、来源服务、关闭无授权调用旁路 |
| `text-chunk.controller.ts`、`knowledge-test.controller.ts`、reindex/analytics 服务 | 关闭旧外部入口；不能把测试/运维工具当授权例外 |
| `enterprise.controller.ts`、`member.service.ts`、`enterprise-context.service.ts` | 新 view 投影及知识角色映射；旧无 view 接口保持兼容 |
| `conversation-stream.service.ts`、相关会话/员工策略 | 退场旧 RAG，普通聊天使用权、附件与工具/超时回归 |
| `common/filters/http-exception.filter.ts`、CSRF Guard | 知识库 code 安全投影、精确原生写请求适配，网关和其他业务封装不变 |
| `knowledge.module.ts`、启动/部署配置 | 注册新增服务/worker；如新增模块按项目规则注册 `app.module.ts`；保留附件解析依赖 |

模块/新文件名在实际实现时按既有模式确定，不因本表机械创建一套庞大的 repository/框架层。

## 10. 测试与验收

### 10.1 必补自动化测试

| 测试面 | 最低用例 |
| --- | --- |
| 权限 | 管理员/普通成员/主管/平台运维；两企业；详情/文档/预览/检索/来源；离职、降权、重入职、撤权及幂等回放 |
| 授权 | 未来文档自动纳入；重复授权；混入跨企业/无效成员整批失败；管理员隐式权限不能靠撤销显式 grant 消除 |
| 并发与幂等 | If-Match 缺失/过期，revision 冲突，同键同参/异参/处理中，提交后响应丢失，先鉴权后回放 |
| 文件与版本 | 同名上传不覆盖；指定替换；相同 active 哈希 unchanged；v1 可用且 v2 失败；同文档并发替换；删除与发布竞争 |
| 作业可靠性 | DB 提交后队列失败、重复投递、重启恢复、过期租约、旧 worker 发布、人工重试新代次，有限自动重试 |
| 解析与模型 | 正常/空文本/加密 PDF、非法编码、伪扩展名、DOCX 解压风险、数字内容保留、向量数量/维度/顺序/NaN/零向量；失败不 READY |
| 检索与来源 | 四状态、partial、显式范围整体校验、query embedding 降级、词法失败 503、token 预算、历史版本来源、撤权/删除中途最终校验 |
| 旧入口关闭 | 旧 API 直调失败且无副作用，旧字段 strict 拒绝；旧 URL 不发知识请求，订阅面板不再读写知识绑定 |
| 非目标兼容 | 原成员列表/组织页面、EmployeeGrant、普通聊天及使用权、SSE/附件/工具/超时、旧消息来源展示、全站认证 |
| 生产边界 | `NODE_ENV=production` 的真实主进程请求可按确定策略写入；代理保留关键头，错误 code/no-store、201/202/204、静态 search 路由正确 |

现有知识库 `*.spec.ts` 是起点，不证明上述矩阵已覆盖；Web 的 `knowledge-test-dialog.tsx` / `use-knowledge-test.ts` 是产品功能，不是自动化测试。

后端单测 mock Prisma，不连接真实生产 DB。并发事务、pgvector、队列故障和 worker 重启应在隔离集成环境验证。文件样本使用可公开或经授权的测试材料，不将企业真实敏感资料提交 Git。

### 10.2 实施后的建议命令

以下是后续实施验证命令，本次仅写文档未执行。先跑改动对应测试，再扩展检查范围；新增测试文件须显式纳入执行。

```bash
# 现有专项测试作为基线，不能代替新增版本/授权/迁移用例
pnpm --dir backend exec jest --runInBand src/modules/knowledge src/modules/enterprise/enterprise-context.service.spec.ts src/modules/enterprise/member.service.spec.ts
pnpm --dir backend exec jest --runInBand src/modules/conversation/conversation-runtime-policy.spec.ts
pnpm --dir backend run typecheck
pnpm --dir web exec vitest run src/features/subscription/employment-row.spec.ts src/features/chat/use-subscribed-employees.spec.tsx src/lib/__tests__/api-client.test.ts
pnpm --dir web exec tsc --noEmit --incremental false
pnpm build
```

schema 变更按项目规则在获准开发库执行 `pnpm db:migrate` → `pnpm db:generate`；上线使用项目核准的生产迁移流程，不在生产执行开发迁移或 `db:reset`。现有 lint 脚本执行前核对是否会自动修改文件及工具兼容性，不能把未执行 lint 写成通过。

Web 管理重构仍须启动本地页面做 Playwright 实测与截图，覆盖桌面/窄屏、导航、旧 URL、订阅授权弹窗和聊天引用；检查没有重叠/溢出、无旧片段/订阅绑定请求及控制台异常。现有 Playwright 配置默认 4173，而 `pnpm dev:web` 默认 3000，复用服务器时显式设置 `PLAYWRIGHT_BASE_URL`，不直接假设默认能跑通。mock 界面验证与真实后端联调证据分别记录。

### 10.3 最小真实联调用例

1. 企业 A 管理员在客户端空列表创建知识库；企业成员无授权时看不到库，直接猜 ID 也不能读。
2. 管理员上传真实文本 PDF/DOCX/TXT/MD，202 后轮询到 READY，预览结构和位置与原文件一致。
3. 授权 A 成员，成员可预览、检索和点击来源；企业 B 任何身份不能读取。
4. v1 已生效时上传 v2：处理期间仍检索 v1；制造 v2 失败仍可使用 v1；修复后成功切换，旧引用明确为历史版本。
5. 替换相同 active 文件返回 unchanged；同名新上传是另一个文档；并发管理员操作得到明确冲突。
6. 撤销成员授权后，后续列表/预览/检索/来源/幂等回放立即失效，客户端清缓存；离职与降权也满足规则。
7. 在途处理时删除文档/库，worker 恢复或迟到发布不能使内容复活；队列短暂不可用后已接受任务能恢复。
8. query embedding 故障只返回明确词法降级；入库 embedding 故障不能 READY，词法/DB 故障不能显示普通无命中。
9. 旧 Web 页面、旧绑定、切片读写、下载、辅助检索及订阅知识入口不能绕过；普通聊天与员工使用授权仍正确。

### 10.4 交付证据

每阶段实施记录至少给出：提交/工作区基线、环境、执行命令和结果、失败/未验证项、requestId/searchId、测试资料标识、迁移差异和回退结果。真实链路证据不包含 token、内部原件路径或企业正文。

最终放行条件是“网页管理闭环 + 客户端业务闭环 + 成员权限闭环 + 可靠版本发布 + 旧旁路关闭”同时成立，而不是仅页面改版或 TypeScript 编译成功。分批实现不代表完整 V1 已交付。

## 11. 待评审项与交付物

### 11.1 必须确认但不阻止先做静态准备的事项

| 事项 | 本文建议/待办 |
| --- | --- |
| Web 最终边界 | 2026-10-16 已调整为保留企业管理端；客户端仍保留完整操作，普通成员网页工作台暂不做 |
| 旧 Web 聊天 RAG | 与订阅知识绑定同步关闭；未来 runtime 另评审，历史消息保留 |
| 格式/大小/企业额度 | 沿用客户端契约建议做实测，生产必须有限且由 limits 返回 |
| Embedding 与 tokenizer | 固定 profile，经 sub2api；先验证出口支持，不绕过项目约束 |
| CSRF 原生写请求 | 用真实客户端生产模式请求验证并做最小精确适配 |
| 存量内容 | 确认迁移规模、原件可用性、手工片段隔离和管理员重新授权方式 |
| 历史来源与删除 | 保留期、物理清理 SLA、审计/历史消息策略由产品和安全确认；不承诺永久可追溯 |
| 破坏性接口切换 | 明确客户端版本、旧 SDK/Web 调用方、企业开关/窗口和旧接口下线日期 |
| 质量/容量 | 真实中文业务评测集、数据规模、并发、p95 与备份恢复目标，未实测不承诺数值 |

### 11.2 最终交付清单

- 确认版契约、共享 schema/OpenAPI、字段及错误样例、18 项接口契约测试。
- 成员策略和授权生命周期测试、旧路由关闭清单及防绕过证据。
- 增量迁移、数据分类演练报告、回退说明，保留用户既有数据和修改。
- 私有存储、版本 worker/outbox、格式样本、原子发布及恢复证据。
- 混合检索评测、来源一致性与权限/故障用例，统一模型出口验证记录。
- Web 管理重构与非目标业务回归记录、客户端真实主进程联调证据。
- 部署/监控/额度/备份恢复文档，配置只给变量与用途，不含密钥。

## 附录：本次源码定位依据

以下行号是撰写时定位参考，后续实现可能移动；文件与代码比旧方案描述优先。这里只列能支持重构判断的入口，不把历史文档中的结论当成动态验证。

| 观察 | 代码依据 |
| --- | --- |
| Web 列表/详情/分析页面 | [列表页](<../../web/src/app/(enterprise)/knowledge/page.tsx>)（18/73 行附近）、[详情页](<../../web/src/app/(enterprise)/knowledge/[id]/page.tsx>)（127/199 行附近）、[分析页](<../../web/src/app/(enterprise)/knowledge/[id]/analytics/page.tsx>)（26 行附近） |
| 侧栏入口与混合授权面板 | [enterprise-shell.tsx](../../web/src/components/shell/enterprise-shell.tsx)（108 行）、[grant-panel.tsx](../../web/src/features/enterprise/grant-panel.tsx)（84/129/271 行附近） |
| 旧知识库 hooks/类型 | [use-knowledge-bases.ts](../../web/src/features/knowledge/use-knowledge-bases.ts)、[use-documents.ts](../../web/src/features/knowledge/use-documents.ts)、[use-knowledge-grants.ts](../../web/src/features/knowledge/use-knowledge-grants.ts)、[use-knowledge.ts](../../web/src/features/knowledge/use-knowledge.ts)、[types.ts](../../web/src/lib/types.ts)（398/548/699 行附近） |
| 配置页知识入口 | [model-config-form.tsx](../../web/src/features/enterprise-settings/model-config-form.tsx)（108/183 行附近）、[roles](<../../web/src/app/(enterprise)/settings/roles/page.tsx>)、[api-keys](<../../web/src/app/(enterprise)/settings/api-keys/page.tsx>)、[permission-matrix.tsx](../../web/src/features/enterprise-settings/permission-matrix.tsx) |
| 历史消息来源展示 | [chat-window.tsx](../../web/src/features/chat/chat-window.tsx)（276 行）、[message-bubble.tsx](../../web/src/features/chat/message-bubble.tsx)（135 行附近） |
| 旧 Controller 路由 | [knowledge.controller.ts](../../backend/src/modules/knowledge/knowledge.controller.ts)、[document.controller.ts](../../backend/src/modules/knowledge/document.controller.ts)、[text-chunk.controller.ts](../../backend/src/modules/knowledge/text-chunk.controller.ts)、[search.controller.ts](../../backend/src/modules/knowledge/search.controller.ts)、[knowledge-test.controller.ts](../../backend/src/modules/knowledge/knowledge-test.controller.ts) |
| 企业上下文/成员列表 | [enterprise-context.service.ts](../../backend/src/modules/enterprise/enterprise-context.service.ts)（38/79 行附近）、[member.service.ts](../../backend/src/modules/enterprise/member.service.ts)（22/231 行附近） |
| 两种旧授权与文档模型 | [schema.prisma](../../backend/prisma/schema.prisma)（232/426/2639/2709 行附近） |
| 旧知识读取策略 | [knowledge.service.ts](../../backend/src/modules/knowledge/knowledge.service.ts)（22/133 行附近）、[document.service.ts](../../backend/src/modules/knowledge/document.service.ts)（272 行附近） |
| 处理/队列/解析 | [document-processor.service.ts](../../backend/src/modules/knowledge/document-processor.service.ts)（64/156 行附近）、[knowledge-queue.service.ts](../../backend/src/modules/knowledge/knowledge-queue.service.ts)（123 行附近）、[document-parser.service.ts](../../backend/src/modules/knowledge/document-parser.service.ts)（35 行附近） |
| 检索与 tokenizer/embedding | [knowledge-search.service.ts](../../backend/src/modules/knowledge/knowledge-search.service.ts)（40/341 行附近）、[vector.service.ts](../../backend/src/modules/knowledge/vector.service.ts)（126 行附近）、[lexical-search.service.ts](../../backend/src/modules/knowledge/lexical-search.service.ts)（119 行附近）、[text-tokenizer.service.ts](../../backend/src/modules/knowledge/text-tokenizer.service.ts)（12 行附近）、[embedding.service.ts](../../backend/src/modules/knowledge/embedding.service.ts)（27/100 行附近） |
| 旧聊天 RAG/附件依赖 | [conversation-stream.service.ts](../../backend/src/modules/conversation/conversation-stream.service.ts)（279/617 行附近）、[attachment-context.service.ts](../../backend/src/modules/conversation/attachment-context.service.ts)（4 行附近） |
| 普通聊天使用权校验风险 | [conversation.service.ts](../../backend/src/modules/conversation/conversation.service.ts)（56 行附近）、[subscription.service.ts](../../backend/src/modules/subscription/subscription.service.ts)（500 行附近） |
| HTTP/认证适配差距 | [api-client.ts](../../web/src/lib/api-client.ts)（27/187 行附近）、[http-exception.filter.ts](../../backend/src/common/filters/http-exception.filter.ts)（77 行附近）、[csrf.guard.ts](../../backend/src/modules/security/guards/csrf.guard.ts)（78 行附近） |
| 现有回归起点 | [knowledge-access.spec.ts](../../backend/src/modules/knowledge/knowledge-access.spec.ts)、[knowledge-search.service.spec.ts](../../backend/src/modules/knowledge/knowledge-search.service.spec.ts)、[conversation-runtime-policy.spec.ts](../../backend/src/modules/conversation/conversation-runtime-policy.spec.ts)、[employment-row.spec.ts](../../web/src/features/subscription/employment-row.spec.ts)、[use-subscribed-employees.spec.tsx](../../web/src/features/chat/use-subscribed-employees.spec.tsx) |

初稿仅为静态设计。2026-10-16 按修订范围开始实施，实际代码、验证及剩余项须记入下方实施记录；文档中的目标接口不等于已部署接口。

## 实施记录

### 2026-10-16 第一批

本批完成第 9.1 节的成员权限基础、网页管理重构与旧入口收口。目标是让企业管理员管理同一份平台资料，客户端后续复用这些资料与成员权限；本记录不等同于客户端完整契约交付。原客户端契约未修改。

#### 已实现与主要文件

| 内容 | 实际行为及代码 |
| --- | --- |
| 成员授权数据 | `backend/prisma/schema.prisma` 新增 `KnowledgeMemberGrant` 与库 `revision`；工具生成迁移 `20261016090000_knowledge_member_grants`。保留旧 `KnowledgeGrant`，不自动转换旧权限 |
| 统一访问策略 | `knowledge-access-policy.ts`：从真实企业成员身份解析企业和角色；企业管理员默认管理本企业库，普通成员/部门经理需要显式授权；无成员身份的全局 ADMIN 不获得企业正文权限 |
| 库与授权接口 | `knowledge.service.ts`、`knowledge.controller.ts`：分页与能力元信息、成员批量授权、按 memberId 撤销。整批校验企业归属；事务锁后复核管理员/目标成员；重复授权不新增记录或修订号 |
| 安全候选列表 | `enterprise.controller.ts`、`member.service.ts`：`GET /enterprise/members?view=knowledge-grant` 专用分页投影；旧无 view 接口形状保留 |
| 文档管理 | `document.service.ts`、`document.controller.ts`：沿用过渡上传/状态/重试，新增 READY 文档只读处理片段预览；空文件服务端拒绝；原件下载停用，不返回内部存储路径和原始任务错误 |
| 检索权限 | `knowledge-search.service.ts`：成员范围搜索与结果返回前复核当前成员权限、READY 文档；结果含 documentId/documentName，供网页打开只读预览。旧聊天内部检索保留 EmployeeGrant 并叠加成员知识权限，不靠旧库绑定扩大权限 |
| 旧接口收口 | 手工片段增删改、原件下载、企业重建索引、批量重处理、分析、旧订阅/部门知识授权写入返回受控停用结果；只读旧路径仍走统一内容策略 |
| 缓存与认证 | `knowledge-auth.guard.ts`、`knowledge-no-store.interceptor.ts`：知识接口及 JWT 拒绝设置 no-store。Web 查询按账号/企业/角色隔离，身份变化清除知识缓存并重置当前页面状态；上传 401 只刷新并重放一次，multipart boundary 交给浏览器 |
| Web 管理页面 | `web/src/app/(enterprise)/knowledge/` 及 `web/src/features/knowledge/`：可搜索分页列表，详情四区域“文档 / 成员权限 / 检索验证 / 基本设置”；状态自动刷新、失败重试、只读预览、分页成员选择/批量授权/撤销、正文及来源验证。手机页签两行排列 |
| 非目标功能保护 | `grant-panel.tsx` 仅移除知识库绑定分支，保留数字员工成员/部门使用授权；`model-config-form.tsx` 移除知识配置及提交字段。分析旧 URL 重定向到库详情；普通成员隐藏 Web 管理入口，直访不发起知识管理请求 |

共享表单约束统一为名称最多 80 字、说明最多 1000 字。文件类型和大小提示来自接口 limits；扩展名允许列表不表示本批已完成各格式真实解析验收。前端新增 `shared/*` alias，直接复用后端共享 Zod schema。

#### 执行与验证证据

以下是第一批本地工作区验收记录；提交前的 review 与修复复验见后文，未推送远程。测试中创建虚构企业和资料，不使用真实企业文档。业务数据库和生产环境未迁移；仅新建并使用隔离 PostgreSQL 数据库 `sep_kb_refactor_20261016`。

| 检查 | 结果与证据 |
| --- | --- |
| 后端专项 | `pnpm --dir backend exec jest --runInBand --silent src/modules/knowledge src/modules/enterprise/member.service.spec.ts`：9 套件 / 67 项通过，含 DTO、策略、授权事务、旧入口、检索权限和 Guard 回归。日志中的检索/向量 ERROR 来自预期失败用例 |
| 后端类型 | `pnpm --dir backend typecheck` 通过 |
| 前端专项 | `pnpm --dir web exec vitest run src/features/knowledge src/features/enterprise/__tests__/grant-panel.test.tsx src/features/enterprise-settings/model-config-form.test.tsx src/lib/__tests__/api-client.test.ts`：6 文件 / 49 项通过，含知识接口/交互、账号缓存隔离、员工授权保护、配置提交、上传认证重放 |
| 前端类型与构建 | `pnpm --dir web exec tsc --noEmit --incremental false`、`pnpm --dir web build` 通过 |
| 隔离库迁移 | `prisma migrate deploy` 在专用隔离库成功执行全部 89 个迁移；证据：[migration-deploy.txt](../../outputs/knowledge-refactor-2026-10-16/migration-deploy.txt) |
| 真实数据库服务验证 | 55 项通过：权限/授权生命周期 32、文档只读预览 11、成员真实词法检索 11、无上传/队列/模型调用边界 1。实际运行 PostgreSQL pg_trgm、分词与 BM25。脚本：[service-smoke.cjs](../../outputs/knowledge-refactor-2026-10-16/service-smoke.cjs)；[脱敏证据](../../outputs/knowledge-refactor-2026-10-16/service-smoke-kbsmoke-2026-10-16T02-21-52-089Z-2af490a2.json) |
| 浏览器交互与截图 | Playwright 操作本地 Web，使用独立模拟 API；上传接收提示、只读来源预览、仅提交 query、403/409 提示、普通成员无管理请求/无菜单、390px 无页面横向溢出且四个页签可见等 10 项断言通过。另实际操作成员添加/撤销及失败重试。证据：[browser-checks-result.txt](../../output/playwright/knowledge-refactor-2026-10-16/browser-checks-result.txt) |
| 视觉检查 | 已查看 [桌面文档](../../output/playwright/knowledge-refactor-2026-10-16/desktop-documents.png)、[手机文档](../../output/playwright/knowledge-refactor-2026-10-16/mobile-documents.png)、[手机检索](../../output/playwright/knowledge-refactor-2026-10-16/mobile-search.png)。桌面沿用全局设计语言；手机四页签分两行，表格在自身区域横向滚动 |

浏览器正常流程无页面脚本错误；模拟 403/409 会出现对应 HTTP 资源错误，另有当前 Web 全局通知/员工状态 WebSocket 在模拟登录下的连接警告，不计为知识流程成功证据。未新增完整 HTTP 服务测试，Guard/DTO 单测和直接服务 smoke 不能替代完整认证链路验收。

#### 后续开发与使用条件

> 以下保留第一批结束时的历史状态；其中版本处理和 Web 版本管理已有第二批实现，以文末 2026-10-17 记录为准，不代表这些功能现在仍完全未开发。

1. **启用前需协调前后端升级并迁移实际环境。** 当前已运行的旧后端进程未切换到新 schema；不能直接把当前 Web 页面当作已完成真实后端联调。迁移先备份、确认授权名单；旧库不会自动授予普通成员，管理员需重新显式授权。此次未操作业务库或生产环境。
2. **下一批优先做文档版本和可靠处理。** 不可变版本、原子发布、上传新版本、ETag/If-Match、持久化幂等、outbox/租约/代次、删除与失败恢复均未交付；当前重试仍是旧可变文档流程，不具备失败新版本保留旧 active 的承诺。
3. **检索和来源契约继续升级。** 尚缺完整四状态/partial/降级协议、统一累计 token 预算、真实定位及稳定版本化 sourceId、历史来源保留。当前只读预览是处理片段，不是原始文件阅读器；不伪造页码或 versionId。
4. **真实链路验收待补。** 本批真实 DB 验证使用预置 READY 文档与 chunks，未执行上传→解析→embedding→发布完整链路，未真实调用 sub2api 模型。PDF/DOCX 真实样本、队列恢复、并发、故障注入、性能和生产发布/回退演练尚未执行。
5. **客户端与聊天切换待联调。** 客户端工程不在此仓库；正式联调前需提供过渡接口到最终接口的差异及切换窗口。Web 普通聊天和历史消息未重写；旧内部 RAG 处于权限收紧的兼容阶段，完整退场及 runtime 新方案另批实施。旧表和未被新页面引用的遗留组件暂留，待调用观察后另做清理。



### 2026-10-16 提交前 review 与修复

对第一批前后端改动进行 review，确认并修复以下四个问题，修复后已复核通过：

| 问题 | 修复与回归 |
| --- | --- |
| 列表 hook 在身份切换时复用上一身份的 placeholder | 仅同一身份 scope 可以复用分页数据；新增回归同时验证同身份分页保留数据、企业切换立即清空数据 |
| 撤销末页最后一条授权后停留在越界页 | 撤销成功后回退上一页；新增分页撤销交互回归 |
| 文档响应暴露上传者邮箱和账号 ID | 列表、详情及上传返回只保留上传者展示名，不返回 `uploadedBy`、`uploader.id/email`；新增投影回归 |
| 成员离职级联撤销授权未更新修订号 | 共用离职事务先锁定成员、读取授权，删除成员后递增相关知识库 revision；覆盖管理员移除和主动离职共用路径，新增顺序与无授权回归 |

上述缺陷回归均先在修复前运行并确认失败，再修复并通过。最终专项结果：后端 9 套件 / **70 项**，前端 6 文件 / **51 项**；后端类型检查、前端类型检查和生产构建通过。`git diff --check` 通过。

更新后的隔离数据库 smoke **56 项全部通过**，增加真实数据库上的文档响应投影检查，并将离职验证改为真实 `MemberService.remove`，同时检查级联撤权和 revision 递增。证据：[review 后服务验证](../../outputs/knowledge-refactor-2026-10-16/service-smoke-kbsmoke-2026-10-16T02-52-33-465Z-e307a971.json)。该测试仍为直接服务调用，不覆盖 HTTP 或真实上传、解析、向量化链路。

本次 Git 提交范围为知识库第一批实现、必要的契约/开发文档、回归测试与验收证据。工作区其他模型网关、部署配置及调研产物不包含在本批提交中；业务数据库与生产环境未变更。

### 2026-10-17 第二批：文档版本与可靠处理

本批接续第一批实现文档版本、后台可靠处理和 Web 对应管理操作，属于第 9 节 C/E 的一部分；不表示完整客户端 V1 或整个知识库已经完成。用户选择的平台托管边界不变：原件、解析文字和向量均由平台保存，不提供本地-only 或“仅向量上云即安全”的承诺。

#### 已实现与代码入口

| 范围 | 本批实现 |
| --- | --- |
| 版本模型 | `DocumentVersion` 保存不可变原件元数据与独立处理状态；文档使用 `activeVersionId/latestVersionId` 区分生效版和最新版本。另增加结构化解析块、持久作业、幂等记录及软删除字段。迁移：`20261016093000_knowledge_document_versions` |
| 上传/替换/重试 | 首次上传同时持久化原件、版本与作业后返回 202；同名上传仍为新文档，替换必须指定文档。一个文档至多一个待处理版本；与生效版哈希相同返回 200 + `unchanged=true`。可重试失败版沿用原件并创建新 generation，不在 HTTP 中直接处理 |
| 并发与网络重放 | 文档写操作要求 `If-Match` 强 ETag 和 `Idempotency-Key`；事务中重查权限并锁定资源。ETag 覆盖安全表示，包括阶段与进度，不只包含 revision；409/412 后前端刷新并要求重新确认，不自动覆盖。幂等键相同但请求内容变化返回冲突 |
| 可靠作业 | PostgreSQL 作业表作为 outbox，BullMQ 仅做可重复投递；120 秒租约、30 秒心跳、fence/generation 隔离过期 worker。自动尝试最多 3 次，等待后重投；格式/空文档等确定性失败不重试。tokenizer 未就绪等运行配置故障有限重试，之后由管理员修复配置再人工重试 |
| 私有原件与清理 | 新原件不放公开 uploads；私有目录/文件权限 0700/0600，并执行文件与目录 fsync。删除先取消/隔离处理并使内容不可读，再持久清理作业。定时扫描 24 小时以上的无引用原件；数据库引用查询失败时不删除，单轮最多扫描 10000 个、删除 100 个 |
| 解析和切分 | 复用已有依赖验证文本 PDF、DOCX、UTF-8 TXT/MD，单文件 10 MiB。PDF 使用真实页码；其他格式页码为 null。解析 worker 有超时、输入/页数/解压上限和外部资源防护；保留数字。真实本地 tokenizer 每片不超过 800 token，最多 20000 片；不下载模型权重，不退化成字符数假 token |
| 模型与发布 | embedding 只经 sub2api；校验批量返回数量、索引、维度和有限值。当前原生向量列要求 1024 维。完成全部切片、词法 tokens、BYTEA/pgvector 和 profile 校验后，事务切换 active；新版失败不移除旧 active，不将 embedding 失败标记 READY |
| 检索与旧入口保护 | 词法/向量查询及返回前复核软删除、生效版本、已发布 generation；版本向量校验 model/dimension/tokenizer/distance。旧 reindex 不得原地修改已版本化内容；旧直接 processor 和旧 enqueue 拒绝调用。完整客户端检索/来源响应另批交付 |
| Web 管理 | 四个页签不变。文档列表展示生效版/最新版、真实阶段、进度和安全错误；增加版本记录、指定上传新版、重试和并发冲突提示。新版失败仍可预览旧生效版，预览翻页固定 versionId；待处理状态自动轮询 |

主要文件：`backend/src/modules/knowledge/document.service.ts`、`document-processor.service.ts`、`knowledge-queue.service.ts`、`knowledge-private-storage.ts`、`knowledge-publication.ts`、parser/chunker/embedding 与检索服务；`backend/prisma/schema.prisma`；`web/src/features/knowledge/` 中的文档列表、版本弹窗、预览和 hooks；共享 DTO、Web API headers helper 及类型。

#### 本批实际接口与过渡边界

本批没有宣称第 5 节目标路由全部交付。当前 Web 使用以下已实现接口（均省略 `/api`）：

| 方法与路径 | 行为 |
| --- | --- |
| `POST K/documents/upload` | 过渡上传路径，已完整接入新上传用例、管理 guard、幂等和可靠作业，202；最终 `POST K/documents` 仍待契约批统一切换 |
| `POST D/versions` | `multipart file` + `If-Match` + `Idempotency-Key`，202 或 unchanged 的 200 |
| `GET D` / `GET D/versions` | 安全文档详情/版本列表；详情 body 返回 etag，详情及成功上传/重试响应同时返回 ETag header |
| `POST D/reprocess` | 过渡重试路径，仅接收空对象和写入头，持久化新代次后 202；不是旧直接重建流程 |
| `DELETE D` | 两个写入头，立即不可见并创建清理作业，204 无 body |
| `GET D/preview` | 当前生效版本解析纯文本分页，支持固定 versionId，切版返回冲突；不是原件下载或历史来源接口 |

列表仍沿用过渡数组/前端筛选方式，版本记录未加独立分页；最终分页、capabilities、limits 和所有统一写入契约不能据此视为完成。幂等记录当前按用户+库+key 唯一且未设置 TTL；前端每次独立操作使用新 key，同一次不确定网络重放保留原 key。旧 READY/FAILED 数据首次管理变更时按原 docId 接入版本模型，不伪造历史 PDF 页码或历史 embedding profile。旧 READY 接入版本模型时，仅写入明确的历史来源标记 `{kind: 'legacy-adopted', compatibility: 'model-only'}`，保留旧路径按模型名称匹配的兼容能力，并继续检查生效版本、发布状态、代次和删除状态；这不代表旧向量的 tokenizer/模型修订已被验证。新处理版本仍必须匹配完整 profile，普通空值、不完整或错误 profile 不享受此兼容例外。

#### 本地验证与证据

仅对虚构资料和专用隔离库 `sep_kb_refactor_20261016` 执行迁移/验证，没有迁移业务库或生产环境；本批代码可提交，但尚未推送远程。

| 检查 | 实际结果与边界 |
| --- | --- |
| 后端专项 | 知识库 + 企业成员服务专项 22 suites / 347 tests 通过，含真实 PDF/DOCX 库、上传 guard/HTTP、成员权限、幂等重试、发布过滤、片段只读边界和 profile 兼容；预期故障注入日志不是线上故障 |
| HTTP 契约 | 新增 3 个测试文件共 56 项；真实 Nest/controller/guard/Multer/Zod，token 验证、权限和数据库为替身。覆盖上传前管理检查、未知字段、10 MiB、ETag、202/200、204 和冲突传播；不能替代真实 JWT + DB 端到端联调 |
| 隔离数据库完整领域链 | `node backend/test/knowledge-version-smoke.cjs` 的 14 项场景通过：首次入库、幂等、去重与并发、新版失败保留旧版、人工重试、确定性失败、租约恢复、恢复时替换过期解析块、旧 FAILED 接入、旧 READY 首次版本化及新版失败后旧版向量/词法仍可检索、未发布片段不可见、处理时删除、整库删除。真实私有文件/TXT parser/PostgreSQL/pgvector/词法；embedding 与 tokenizer 为显式测试替身，未覆盖真实 Redis 中断 |
| 前端专项 | `pnpm --dir web exec vitest run src/features/knowledge src/lib/__tests__/api-client.test.ts`：5 文件 / 81 项通过；包括版本上传/冲突/重放、旧版预览、轮询、权限失效和 legacy FAILED 重试 |
| 类型与构建 | 前端 `tsc --noEmit --incremental false`、前端生产构建、后端生产构建通过。全仓后端 typecheck 曾被同时开发的 media-gateway 类型/测试错误阻塞，最终重新执行 `pnpm --dir backend typecheck` 已通过 |
| 静态检查 | 后端知识库范围 ESLint 0 errors / 9 warnings（parser worker require、既有词法 tokenizer 注释等）。前端本批修改文件 ESLint 通过；整个目录检查仍命中未在本批修改的 `knowledge-dialog.tsx:54` 既有 `set-state-in-effect`，未擅自改写建库表单。知识库本批目标范围 `git diff --check` 通过 |
| 页面证据 | 本地 Web + 模拟 API 的桌面/390px 截图保存在 `output/playwright/knowledge-versions-2026-10-16/`，覆盖版本记录、旧版预览、新版本未变化提示。桌面以 `desktop-versions-stable.png` 为准：等待弹窗动画结束后 opacity=1、运行中动画为 0、无横向溢出，已实际查看；原桌面图为动画中间帧。模拟界面不等于真实上传/模型链路联调 |

#### 启用与尚未完成

1. **协调升级，不与旧 worker 混跑。** 先备份并停止旧知识处理 worker，再执行本批新增迁移、生成 Prisma client、切换前后端与新 worker。维护逻辑会将无版本的旧 PENDING/PROCESSING 标成 FAILED，管理员之后进入新持久重试；未经停止旧 worker 不能安全启用这一步。本次只在隔离库执行 `migrate deploy`，未代操作业务发布。
2. **部署持久且共享的私有原件卷。** 配置 `KNOWLEDGE_PRIVATE_PATH`；API/worker 多副本必须可访问相同持久路径，不能依赖临时容器本地盘。保留旧原件路径的可达性；缺失旧原件需要管理员补传，不能凭空恢复。私有目录不挂到静态服务。
3. **先配好模型和 tokenizer，再真实验收。** `.env.example` 已改为统一 sub2api 出口及 tokenizer/私有目录配置；准备与模型相同修订的本地 tokenizer 文件，配置 `EMBEDDING_TOKENIZER_PATH`。固定 model/tokenizer 的不可变修订和 1024 维/cosine。示例 `BAAI/bge-m3` 是可变别名，不构成生产已固定权重或网关已支持的证据。当前未调用真实 embedding，缺少这些条件时文档不会假装处理成功。
4. **检索与来源是下一批。** 完整四状态、partial/degraded、累计 token 预算、精确版本化 sourceId/location、历史来源保留、最终客户端路由与 DTO 差异收口、客户端联调尚未完成；当前 active 预览不能冒充旧命中来源。旧聊天 RAG 仍是第一批权限收紧后的兼容阶段，未在本批擅自重写。
5. **生产治理尚有待办。** 企业总容量原子配额、企业/用户限流、版本/幂等保留期、孤儿扫描大目录轮转、持久任务可观测告警及故障恢复运维闭环未完整交付；真实 sub2api、真实 Redis 故障注入、多实例长期恢复、生产发布/回退和性能验收待执行。不可把本批标为整个 Phase C 或产品生产验收完成。
