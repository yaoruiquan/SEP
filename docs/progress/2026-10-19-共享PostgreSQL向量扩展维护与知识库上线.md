# 共享 PostgreSQL 向量扩展维护与知识库上线

日期：2026-10-19，UTC+8。承接同日的[首次发布与回滚记录](./2026-10-19-知识库生产发布与回滚记录.md)。

最终状态：共享 PostgreSQL 维护、SEP 结构补偿及知识库应用发布成功。2026-10-19 14:19:52 完成切流后观察及旧环境排空，生产活动目标为 `sep-blue-web`。未向远程仓库 push。

## 授权与范围

用户确认采用保留共享实例、补齐向量扩展的方案，接受维护期间 SEP 和 sub2api 数据库访问短暂中断。只替换 PostgreSQL 镜像并修复 SEP 缺失结构，不升级数据库版本，不移动数据卷，不重建 Redis/Caddy/Ollama/sub2api，不重建现有企业文档。

## 数据库基线

- 原容器：`longdao-postgres-pre-pgvector-20260827`，PostgreSQL 18.4 / Alpine 3.24.1 / x86_64。
- 精确基础镜像：`postgres@sha256:9a8afca54e7861fd90fab5fdf4c42477a6b1cb7d293595148e674e0a3181de15`。
- 真实 `PGDATA=/var/lib/postgresql/data`，命名卷 `longdao_postgres_data`；保留该路径，不能照搬 PostgreSQL 18 默认目录。
- 新镜像：`longdao-postgres-pgvector:18.4-v0.8.1-9a8afca54e78`；pgvector 源 commit `778dacf20c07caf904557a88705142631818d8cb`。
- pgvector 归档 SHA-256：`4c33cf053329784ba6d992d05c9588b93789e907a7511f20ff5a5a5b8a0703c1`。
- 多阶段构建只将扩展文件加入原运行时。新旧 `/usr/local/bin/postgres` 二进制 SHA-256 一致。

## 已完成的发布前验证

1. 备份所有 5 个非模板数据库及全局角色。`sep_prod`、`sep_dev`、`sub2api`、`postgres` 和历史备份库全部成功恢复到隔离容器；不是仅验证 dump 目录。
2. 仅在恢复库运行结构补偿，重复执行通过；原 62 个文本块保留 BYTEA，新列均为 NULL，没有回填或伪造模型标签。
3. 实测缺扩展、错误维度、错误索引被断言拦截；错误维度时补偿事务整体回滚，未留下新建索引。
4. 重建隔离容器后，恢复数据和扩展仍然存在。与全新执行 91 次迁移的空库比对，schema 仅新向量列的物理排列顺序不同。
5. 共享 Compose 配置经解析比较，只有 PostgreSQL 镜像变化。生产候选环境配置只有 embedding/tokenizer/私有存储项变化，未改变认证、中转和图片功能开关。
6. 新增实际结构发布门禁，迁移之后、候选启动之前验证扩展、1024 维列及有效部分 HNSW cosine 索引。历史迁移与账本不修改。

## 隔离验收发现与修复

第一次使用真实 HTTP 上传合成 TXT，作业报 `INVALID_DOCUMENT`。根因为 Webpack 改写了序列化 worker 内的模块加载器及 `require.resolve`，不能靠源代码单测发现。

`d9e9a65` 修复为在线程上下文注入 Node 原生 `require`，主线程使用 `createRequire` 解析真实依赖路径，并增加 Webpack 打包后的 TXT/DOCX/PDF 回归测试。先复现失败，再修复通过；不放宽解析安全限制。

复验确认新版本已完成解析和 1024 维写入，但一秒一次的 HTTP 轮询触发了错误套用的 `auth` 桶（10 次/分钟），导致验收及清理收到 429。`820b655` 仅使四个文档轮询 handler 不再消耗 auth/chat 桶，保留全局 default 桶和原 JWT/权限逻辑，不调整登录接口或检索专用限流。新增真实全局 ThrottlerGuard 的 GET/HEAD、默认配额、匿名拒绝与非轮询 handler 回归，先复现 8 项失败再修复。

最终本地验证：知识库 30 套测试，492 项通过、4 项跳过；后端 typecheck、定向 ESLint 通过。发布、排空、Compose 与维护脚本回归通过，维护用例 10 项通过。未执行全量后端测试，未改动工作树已有的网关/健康检查等其他修改。

真实验收使用独立空迁移库 `sep_pgvector_rehearsal_20261019`、独立 Redis、临时私有存储及合成企业身份，不向生产克隆库启动 worker。`backend/test/knowledge-deployment-smoke.cjs` 硬性限制数据库名，在 finally 清理本轮 fixture，并以安全状态码输出 JSON，不记录 token 或原文。

最终 `820b655` Linux 镜像以 `NODE_ENV=production` 运行，未设置放宽限流的 `E2E_TEST`。请求携带隔离 CORS Origin，使用独立测试签名密钥；SMTP 为不可用的隔离占位配置，中转调用地址禁用，不验证邮件或付费模型。真实 Ollama、tokenizer、PostgreSQL 和 Redis 均参与验收，15 项全部通过，29 秒完成，fixture 清理通过：上传持久作业、READY、原生 1024 维及 BYTEA 双写、固定 digest 与实际向量一致、显式纯 vector 命中、未授权拒绝、授权后 search/source/preview、外企拒绝、版本原子切换、撤权立即拒绝、删除及原件异步清理。该证据使用 WEB 会话，不代替真实桌面客户端联调。

正式发布脚本重新构建了镜像，因此对其最终后端镜像再次复验，而非仅沿用预构建标签的结果。镜像配置 ID 为 `sha256:b072786791e0e25d7f141edd3f1e9defdad9ce5e7cef4b04fb4fc07a2b1cec4c`，相同的 15 项全部通过，38.966 秒完成，fixture 清理通过，证据为 `knowledge-isolated-smoke-final.json`。复验启动前断言数据库主机和库名、Redis 主机均为隔离实例，未连接生产业务库。

## 生产启动检查修复

首次正式发布在切流前被拦截，候选安全退役，绿色旧版继续服务。原因不是结构或解析失败，而是 `/api/health/ready` 会实际执行嵌入检查：Ollama 日志证实首次冷加载后的 `/api/embed` 用时 8.7529 秒，超过发布脚本原有 5 秒请求时限。随后只读诊断返回 200，六项依赖均为 `ok`。

`2247967` 将首次部署及恢复启动的后端就绪请求上限设为 130 秒，覆盖现有 120 秒 embedding 请求预算及少量依赖检查余量；Web 探测和切流后六次观察仍为 5 秒。新增超时参数校验、冷启动部署及恢复回归；先复现测试失败，再修复通过。发布、排空、Compose、shell 语法和 smoke helper 语法检查均通过。

此提交只改发布控制脚本及测试，不改应用运行代码。本次没有重新构建或换掉已验收的 `820b655` 应用镜像，而是在干净的 `22479670d6ca` worktree 加载修复后的发布函数，逐项核对后继续已完成构建与迁移的候选：差异仅为四个发布/测试文件、环境配置逐字一致、前后端镜像摘要固定、迁移容器成功退出；重新执行共享依赖、实际 schema、容器健康、准入恢复及完整 readiness 后，才切流和观察。没有跳过失败门禁，也没有将未验收镜像冒充已通过版本。

## 生产结果

1. 13:36:35 至 13:36:58 完成数据库镜像维护，窗口 23 秒。新容器 `longdao-postgres` 健康，PostgreSQL 仍为 18.4，pgvector 为 0.8.1；原数据卷、集群标识及 5 个数据库清单一致。
2. 停库冷备成功后才替换镜像。共享 Compose 仅修改 PostgreSQL 镜像，未重建 Redis、Caddy、Ollama、sub2api 或 dev 环境；恢复后 SEP readiness 和中转 health 均返回 200。
3. 仅对 `sep_prod` 事务性补齐扩展、`vector(1024)` 列和部分 HNSW cosine 索引，事务内结构断言通过。未编辑迁移历史。
4. 补偿前后，原 4 份文档及 62 个文本块的逐行聚合摘要与备份基线完全一致。旧文本块原生向量仍为 NULL，没有改写旧模型或向量。
5. 使用生产应用角色 `sep_app` 在只读事务执行 1024 维向量运算和表查询成功，自相似度为 1；未使用管理员账号代替应用权限验收。
6. 从独立、干净的 `820b6550e3ff` worktree 完成应用构建和迁移检查；候选配置只恢复已审核的 embedding/tokenizer/私有存储项。成功迁移记录 91 条，另有 2 条已回滚历史记录，无未完成迁移；本轮未应用新迁移或修改账本。
7. 14:18:33 至 14:19:52 使用修复后的发布控制脚本继续发布。六次观察通过，每次间隔 10 秒；活动目标 `sep-blue-web`，`previous-target=sep-green-web`，旧版经正常排空和 SIGTERM 退出，保留镜像及容器用于应用回退。
8. 生产应用镜像：`sep-blue-backend:820b6550e3ff`、`sep-blue-web:820b6550e3ff`。运行后端摘要与最终隔离复验完全相同：`sha256:04c8d3c7012512519534cd087e43439afa0af20f0d4f420632579d760d9ce3db`；前端摘要 `sha256:558ec8406d1582b41bc2a0dc8b1629d09c33d7cd594b2a3a6140886e0ae11015`。
9. 公网首页、readiness 和 sub2api health 均为 200，readiness 的 PostgreSQL、Redis、任务队列、知识库队列、中转和 embedding 六项均为 `ok`；知识库列表、检索和管理监控接口匿名请求均为 401。生产应用、共享依赖及 dev 容器均健康。
10. 发布后再核对，文档 4、版本 0、任务 0、文本块 62、原生向量 0；原文档/文本块摘要仍与备份基线一致。`sep_app` 保持非超级用户、无建库/建角色权限，不能连接 `sub2api` 数据库。
11. 删除本次四个临时验收容器、临时数据卷和隔离网络，避免留下额外的业务库恢复副本。正式 dump、角色备份、冷备及证据保留在受保护目录；冷备 SHA-256 校验通过，收尾时宿主机可用磁盘约 18 GB。

## 证据与回退

服务器证据目录：`/opt/sep/backups/pgvector-20261019/`，权限 0700，配置、角色备份和 dump 不进入 Git。该目录包含备份校验、恢复日志、schema 比对和隔离验收结果。

主要收尾证据：`maintenance.log`、`production-schema-repair.log`、`knowledge-isolated-smoke-final.json`、`deploy-820b655.log`、`deploy-820b655-resume.log`、`production-final-http.json`、`production-final-schema.log`、`legacy.after-deployment.txt`、`rehearsal-cleanup.log`、`pgdata.before-image.sha256`。一次性维护和续发脚本同目录留档，不作为普通自动发布入口。

停库采用 SIGINT 并确认退出，不在未确认退出时强制重建。冷备先写 partial，完整成功才改名；空间预算按实际卷大小计算并保留余量。原数据库标识和数据库清单已完成切换前后核对。

共享部署源文件 `/opt/longdao/deploy/production/docker-compose.yml` 已持久化新镜像引用；该独立仓库存在先前的其他修改，本次不替它提交或覆盖这些改动。后续共享服务部署必须保留此扩展镜像，不得恢复浮动的 vanilla PostgreSQL 镜像。

无 schema 变更时可回退原精确镜像和同一数据卷，禁止自动恢复 dump 覆盖业务数据。扩展已经使用后，优先只回退应用并保留健康的扩展镜像，不能直接换回缺少库文件的 vanilla 镜像。

历史 4 份 READY 文档、62 个旧模型文本块不在本次重建范围。固定 profile 的向量检索需管理员明确重新发布资料；不能把旧向量改名冒充兼容。本次不等同于真实企业语料效果或客户端联调的完整验收。
