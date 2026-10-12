# SEP 部署到服务器 — 操作手册

## 前提条件

- 服务器 `64.83.39.223` 已运行 longdao（postgres / redis / sub2api / caddy）
- 服务器已部署 Ollama，已拉取 `bge-m3:latest`，且 SEP 后端容器可通过 Docker 网络访问
- PostgreSQL 已安装 pgvector 扩展包
- 你有一个域名，DNS A 记录已指向 `64.83.39.223`
- 本地 SEP 代码已推送到 GitHub

> **共享基础设施警告**：SEP 与龙道中转站可以共用同一台服务器和 Docker 网络，
> 但不要在 SEP 目录执行会管理 PostgreSQL、Redis 或 Caddy 的命令。
> 当前两个系统使用同一 PostgreSQL 实例的不同数据库：`sep_prod` 和 `sub2api`。
> PostgreSQL 停止时两个系统都会不可用。SEP 部署脚本只操作 `sep-*` 容器。

---

## 步骤一：准备环境变量

```bash
# 在服务器上
cp /opt/longdao/deploy/production/.env /tmp/longdao.env   # 临时查看
mkdir -p /opt/sep
cp /path/to/SEP/deploy/production/.env.example /opt/sep/.env
# 填写 /opt/sep/.env 中的各项值
```

需要填写的内容：
- `POSTGRES_PASSWORD` — 从 `/opt/longdao/deploy/production/.env` 复制
- `REDIS_PASSWORD` — 同上
- `JWT_SECRET` — 兼容旧模块使用，执行 `openssl rand -hex 32`
- `ACCESS_JWT_SECRET` — 认证中心 Access Token 密钥，执行 `openssl rand -hex 32`
- `REFRESH_TOKEN_PEPPER` — Refresh Token 哈希 pepper，执行 `openssl rand -hex 32`；必须与 `ACCESS_JWT_SECRET` 不同
- `MAIL_*` — 真实 SMTP 配置，生产必须保持 `MAIL_ENABLED=true`
- `WECHAT_*` / `QQ_*` — 完成对应开放平台配置后再启用；回调地址必须是公网 HTTPS 地址
- `SUB2API_API_KEY` — 在 sub2api 管理后台新建一个渠道 key
- `EMBEDDING_BASE_URL` — Ollama 在 Docker 网络中的地址，例如 `http://sep-ollama:11434/v1`

部署脚本会在 Compose 启动前执行认证配置预检；不会打印密钥值。后端启动时还会再次校验生产认证配置，避免绕过部署脚本直接启动不安全配置。

先按 [Embedding 服务部署指南](../../docs/deployment/embedding-service.md) 验证 `/v1/embeddings` 返回 1024 维向量，再启动 SEP。

---

## 步骤二：创建 SEP 数据库

```bash
# 找到当前 PostgreSQL 容器（容器名可能因恢复或升级而变化）
PG_CONTAINER=$(docker ps \
  --filter network=longdao-network \
  --filter label=com.docker.compose.service=postgres \
  --format '{{.Names}}' | head -n 1)
test -n "$PG_CONTAINER" || { echo "PostgreSQL 未运行"; exit 1; }

# 在共享 PostgreSQL 实例内创建独立数据库
docker exec -it "$PG_CONTAINER" psql \
  -U sub2api \
  -c "CREATE DATABASE sep_prod;"

# 验证
docker exec "$PG_CONTAINER" psql -U sub2api -c "\l" | grep sep

# 确认数据库镜像已提供 pgvector，再在 SEP 数据库启用扩展
docker exec "$PG_CONTAINER" psql -U sub2api -d sep_prod \
  -c "CREATE EXTENSION IF NOT EXISTS vector;"
docker exec "$PG_CONTAINER" psql -U sub2api -d sep_prod \
  -c "SELECT extname FROM pg_extension WHERE extname = 'vector';"
```

---

## 步骤三：克隆代码到服务器

```bash
cd /opt/sep
git clone https://github.com/你的账号/SEP.git app
```

---

## 步骤四：更新 Caddyfile

```bash
# 1. 把 Caddyfile.snippet 中的 your-sep-domain.com 替换为真实域名
# 2. 追加到现有 Caddyfile
cat /opt/sep/app/deploy/production/Caddyfile.snippet \
  | sed 's/your-sep-domain.com/你的真实域名/' \
  >> /opt/longdao/deploy/production/Caddyfile

# 3. 验证 Caddyfile 语法
docker exec longdao-caddy caddy validate --config /etc/caddy/Caddyfile

# 4. 热重载（不中断现有服务）
docker exec longdao-caddy caddy reload --config /etc/caddy/Caddyfile
```

---

## 步骤五：构建并启动 SEP

```bash
cd /opt/sep/app/deploy/production

# 使用保护脚本：迁移前会检查共享数据库和 Redis，只操作 SEP 容器
chmod +x ./sep-deploy.sh
DEPLOY_SHA="$(git rev-parse HEAD)" ./sep-deploy.sh deploy

# 查看日志
./sep-deploy.sh logs
```

---

## 步骤六：验证

```bash
# 检查容器状态
docker ps | grep sep

# 检查 backend 健康
curl http://localhost:3001/health

# 从后端所在网络验证 Ollama（地址与 /opt/sep/.env 一致）
curl http://127.0.0.1:11434/api/tags
curl -X POST http://127.0.0.1:11434/v1/embeddings \
  -H 'Content-Type: application/json' \
  -d '{"model":"bge-m3:latest","input":"生产验收"}'

# 检查 web
curl -I https://你的域名
```

---

## 日常维护

```bash
# 更新代码并重新部署（不要使用 docker compose down）
cd /opt/sep/app
git pull
cd deploy/production
# 脚本不会在发布过程中再次 pull；可由 CI 传入完整 SHA 做一致性校验。
DEPLOY_SHA="$(git rev-parse HEAD)" ./sep-deploy.sh deploy

# 查看日志
./sep-deploy.sh logs sep-backend
./sep-deploy.sh logs sep-web

# 停止 SEP 应用（不会停止共享 PostgreSQL、Redis 或 Caddy）
./sep-deploy.sh stop
```

## 自动资源维护

生产机使用 `maintenance-sep.sh` 定期清理可重建的 Docker BuildKit 缓存和 systemd journal。脚本同时获取维护锁与 SEP 部署锁，部署期间跳过维护，支持磁盘阈值告警。不会执行 `docker system prune -a` 或全局容器清理，不删除镜像、数据卷、备份、已停止的回滚环境或暂时停用的 Ollama。

在服务器首次安装（路径按实际 checkout 调整）：

```bash
cd /opt/sep/app/deploy/production
chmod +x maintenance-sep.sh
install -m 0644 sep-maintenance.service /etc/systemd/system/sep-maintenance.service
install -m 0644 sep-maintenance.timer /etc/systemd/system/sep-maintenance.timer
install -m 0644 sep-maintenance.logrotate /etc/logrotate.d/sep-maintenance
systemctl daemon-reload
systemctl enable --now sep-maintenance.timer
systemctl list-timers sep-maintenance.timer
```

默认每周日凌晨运行，按 7 天窗口清理旧构建缓存，并设置 20 GB 缓存保留预算；保留 14 天 journal，维护日志每周轮转并保留 8 份。磁盘达到 75% 会记录告警，达到 85% 会解除缓存年龄筛选，但仍保留缓存预算；清理后仍超过 85% 会以失败退出，交给人工处理。预算不保证磁盘上的所有缓存立即降至 20 GB，仍受可回收范围及年龄筛选限制。可通过 systemd override 调整：

```bash
systemctl edit sep-maintenance.service
```

```ini
[Service]
Environment=SEP_MAINTENANCE_WARN_PERCENT=75
Environment=SEP_MAINTENANCE_CRITICAL_PERCENT=85
Environment=SEP_BUILD_CACHE_AGE=168h
Environment=SEP_BUILD_CACHE_KEEP_STORAGE=20GB
Environment=SEP_JOURNAL_RETENTION=14d
Environment=SEP_JOURNAL_MAX_SIZE=500M
```

手动执行和查看日志：

```bash
systemctl start sep-maintenance.service
journalctl -u sep-maintenance.service --since "1 hour ago" --no-pager
tail -100 /var/log/sep-maintenance.log
```

脚本只回收可重建缓存；旧发布镜像和备份不会自动删除，避免失去回滚版本或恢复点。定期仍需人工检查 `docker system df` 和备份保留策略。

蓝绿发布前的缓存清理默认使用 48 小时窗口及相同的 20 GB 保留预算，可以用 `SEP_PRUNE_BUILDER_CACHE=false` 跳过。生产蓝绿环境和联调环境的前后端均配置 JSON 日志轮转（每份 20 MB，最多 5 份）；已有容器需重建后生效，仅修改 Compose 文件或 `docker restart` 不会更新日志驱动参数。

人工删除历史 SEP 镜像时，必须保留当前 `active-color` 和 `previous-target` 容器实际引用的镜像，以及联调和共享服务镜像；先按明确版本列出候选，检查所有运行及停止容器引用，再执行不带 `--force` 的定向 `docker image rm`。不要用镜像年龄判断取代实际引用检查。

### 暂停本地嵌入服务

用户要求暂时停用知识嵌入时，使用 `docker stop sep-ollama`，并将容器重启策略设为 `unless-stopped`，避免宿主机重启后自动恢复已手动停止的服务。保留容器、模型卷和镜像；恢复使用 `docker start sep-ollama`。

当前应用将嵌入服务作为生产 readiness 的必需依赖。因此停用期间 `/api/health/ready` 会如实返回 503、`checks.embedding=failed`；知识向量生成及语义检索暂不可用，现有发布/回滚脚本也会在 readiness 检查处阻止切换。普通 Web、认证、技能审核和模型网关仍可独立运行。不要将健康检查改为假成功；需要再次发布或回滚时先恢复嵌入服务，或另行实现明确的功能停用与降级契约。

## 蓝绿发布与回滚

CI 应在服务器 checkout 后把待发布的完整 commit SHA 传给脚本：

```bash
DEPLOY_SHA="$GITHUB_SHA" \
SEP_POST_DEPLOY_CHECKS=6 \
SEP_POST_DEPLOY_INTERVAL_SECONDS=10 \
./sep-deploy.sh deploy-bluegreen
```

脚本会用该 SHA 生成默认镜像标签（短 SHA），并拒绝部署到不同 checkout。候选色会同时启动后端和前端，readiness 通过后 Caddy 的 Web 与 `/ws/*` upstream 一起切换；旧色会在发布后观察期和排空时间内保持运行。观察失败时脚本会先切回旧色，再排空候选色。Caddy reload 或配置校验失败会尝试恢复切换前的备份；无法确认运行态时保留两色容器并报失败，不假定切回已经成功。

每次部署启动候选后端前，脚本会检查共享 `sep_uploads` 卷，将上传目录修正为 `node` 用户可写，并用 `node` 用户实际执行临时写入/删除验证。候选环境的 readiness 也会再次做写入检查；失败时不会切换 Caddy。生产本地存储路径固定为 `/app/uploads/chat`。

观察通过后才会排空旧色。`deploy`、`deploy-web`、`deploy-backend` 现在都是成对蓝绿发布的兼容入口，不再原地停止或重建活动容器。即使仅更新 Web，也保留旧 Web 到 Gateway 请求完全释放，因为模型流仍可能经旧 Web 代理。候选色只允许覆盖已停止或尚不存在的容器；上次排空失败留下的运行中色不会被下一次发布强制重建。

手动回滚使用：

```bash
./sep-deploy.sh rollback-bluegreen
```

回滚启动保留容器所引用的原镜像，不使用当前 checkout 的镜像标签重新创建 previous 环境。previous 健康、恢复准入且 readiness 通过后才切流，然后用同一排空流程停止离任色。普通 `restart [all|sep-backend|sep-web]` 作用于当前活动色，也先排空 Gateway；仅重启 Web 时，同样等待模型请求归零，Web 恢复后才移除后端排空标记。普通 restart/stop 不切到备用色，会有拒绝新请求或不可用窗口，不承诺零停机。

单独 restart 只对选定角色发送 TERM，不会把运行中的另一角色一起重启；但恢复流程会启动同色已停止的另一角色，并检查整对 Backend/Web。`restart sep-backend` 不再固定操作 legacy 容器，也不能在 Web 不可用时报告成功。排空或停止失败保留 marker；启动、健康检查或恢复 readiness 失败时，会尽力重新标记当前可确认的 backend boot，不盲目删除 marker。若重新标记或探测失败，明确报需人工介入。readiness 要求临时恢复准入后检查，因此验证期间存在短暂准入窗口，不是原子恢复；已接入请求仍由 lifecycle 跟踪，失败后不强杀。

### Gateway 生产参数

两份 production Compose 均透传以下参数，默认值与当前代码一致；蓝绿环境的两色共用该配置。新增配置需要重建容器，单纯 restart 不会更新容器环境。

| 参数（均为 `GATEWAY_` 前缀） | 默认值 | 用途 |
| --- | --- | --- |
| `GATEWAY_MEMBER_CONCURRENCY` | `4` | 成员聚合并发 |
| `GATEWAY_ENTERPRISE_CONCURRENCY` | `32` | 企业聚合并发 |
| `GATEWAY_MEMBER_RPM` | `120` | 成员聚合请求限额 |
| `GATEWAY_ENTERPRISE_RPM` | `600` | 企业聚合请求限额 |
| `GATEWAY_ENTERPRISE_TOKEN_BUDGET` | `0` | 默认关闭保守 token 流量预算；不是资金预占或上游精确 TPM |
| `GATEWAY_DEFAULT_MAX_TOKENS` | `4096` | 未指定输出上限时的默认值，仍受模型能力约束 |
| `GATEWAY_HTTP_JSON_LIMIT` | `4mb` | 仅 POST `/api/gateway/v1/chat/completions` 的 HTTP JSON 解析上限；其他 REST 默认仍为 2 MiB |
| `GATEWAY_MAX_REQUEST_BYTES` | `4194304` | Gateway 模型策略的序列化输入上限（字节），不覆盖全局 HTTP body 限制 |
| `GATEWAY_JSON_MAX_BYTES` | `8388608` | 上游普通 JSON 响应上限（字节） |
| `GATEWAY_ERROR_MAX_BYTES` | `65536` | 上游错误响应上限（字节） |
| `GATEWAY_AUTH_TOKEN_MAX_BYTES` | `4096` | 认证 token 输入上限（字节） |
| `GATEWAY_AUTH_FAILURE_TOKEN_LIMIT` | `120` | 无效认证 token 的限额 |
| `GATEWAY_AUTH_FAILURE_SOURCE_LIMIT` | `1200` | 无效认证来源的限额 |
| `GATEWAY_AUTH_FAILURE_WINDOW_MS` | `60000` | 无效认证限额窗口（毫秒） |

原 `GATEWAY_MODEL_RATE_LIMIT=60`、`GATEWAY_MODEL_RATE_WINDOW_MS=60000` 的企业 + 成员 + 订阅 RPM 继续独立执行，不会被新增成员/企业聚合 RPM 替代；请求必须同时满足这些限制。认证失败限流则独立用于未通过认证的请求，不占用有效身份的准入预算。

请求大小分为 HTTP 原始 JSON 和规范化后的序列化模型请求两个预算，两者默认均为 4 MiB。空白、转义、默认输出字段注入会导致字节数不同；任一超限均明确返回 413，分别使用 `REQUEST_BODY_TOO_LARGE` 和 `MODEL_REQUEST_TOO_LARGE`，不保证原始 body 正好 4 MiB 的请求一定满足规范化预算。调整时应同时核对入口代理上限，不能仅扩大一个阶段。网关不接受未声明的协议字段，返回 400 / `INVALID_PARAMETER` 和具体字段路径，不再静默删除参数。

### Gateway 排空契约

- 控制文件固定为后端容器私有 `/tmp/sep-runtime/gateway-drain.json`，目录权限 `0700`、标记权限 `0600`，不挂载到共享卷。发布脚本通过 `docker exec --user node` 原子写入 `{bootId, token}`。只有可信 Docker 操作者可以写入；没有公开 drain/resume HTTP 端点。
- `GatewayLifecycleService.beginRequest(): () => void` 提供幂等 release。controller 必须在授权开始前调用，在最外层 `finally` 中释放；转发、usage checkpoint、可结算/失败状态标记和准入清理的有界等待结束前均计入 `activeGatewayRequests`。后台扣费不计入 HTTP 活动数，持久待结算记录由后续实例继续补偿；不能把活动归零解释为所有账单已经扣费。仅统计 Gateway controller 接入的请求。
- 切流、观察通过后写旧实例标记，旧实例立即拒绝新 Gateway 请求；每次准入与 health 都读取本地标记。脚本通过容器内根路径 `/health` 轮询同一个 `bootId`，避免 `/api/health` 的全局限流影响每秒探测。活动计数为零才发送停止信号，旧 Web 随后停止。
- `/health` 和 `/api/health` 是只读 liveness，保持 HTTP 200，并报告 `bootId`、`gatewayState`、`draining`、`activeGatewayRequests`、`requestBudgetMs`、`drainGraceMs`、`drainTimeoutMs`。`/api/health/ready` 在 `draining`、`stopping` 或 `control_error` 时始终 HTTP 503，即使 active 为零；响应保留上述字段，不伪装为 ready。停止完成后 HTTP 不可达。
- SIGTERM/SIGINT 将状态永久置为 `stopping`，先等待活动请求归零，再调用 Nest `app.close()`，避免 Prisma/Redis destroy hooks 提前断开。停止状态不能靠删除标记恢复。若进程排空超时，保留进程和 503 状态，不调用强制退出；活动归零后可由可信操作者重试停止。

| 配置 | 默认值 | 约束/用途 |
| --- | --- | --- |
| `GATEWAY_STREAM_TOTAL_TIMEOUT_MS` | `600000` | 流式单次总预算，可调大或调小 |
| `GATEWAY_NON_STREAM_TIMEOUT_MS` | `120000` | 非流式单次总预算 |
| `SEP_GATEWAY_DRAIN_GRACE_MS` | `30000` | 给 usage checkpoint、状态标记和准入清理的余量，不等待后台扣费全部完成 |
| `SEP_GATEWAY_DRAIN_TIMEOUT_MS` | 两种预算最大值 + grace | 未配置或空值时动态计算；低于最大预算 + grace 会阻止后端启动 |
| `SEP_DRAIN_TIMEOUT_SECONDS` | 对实例 drainTimeout 向上取整到秒 | 脚本环境变量；显式值必须同时覆盖实例 drainTimeout 和预算 + grace |
| `SEP_DRAIN_POLL_SECONDS` | `1` | 脚本环境变量，正整数轮询间隔 |
| `SEP_STOP_GRACE_SECONDS` | `30` | 排空归零后 TERM-only 的停止观察时间，也传给 Compose stop_grace_period |

后端毫秒配置必须为 `1..2147483647` 的整数，预算与 grace 的和也必须可作为有效排空时间。例如总预算 900 秒、grace 45 秒，默认排空上限为 945 秒，不受旧 600 秒常量限制。脚本读取运行实例 health 的有效配置，而不是假定新候选和旧实例的预算一致。排空时长使用单次绝对 deadline，不按轮询次数刷新；慢探测可能略超出 deadline，但不会因此强杀。

排空超时、状态探测失败、控制写入失败或 bootId 改变都会报失败并保留旧容器，不发送停止信号。切流已成功时 `active-color` 保持新色、`previous-target` 保持旧色；失败不代表已经自动回滚。旧色通常继续 `draining`，等已有请求收尾。检查 health/日志及执行账本后再决定回滚或重试，不要直接重跑发布去覆盖保留色。

归零后，脚本保存容器原 restart policy 到部署状态目录，禁用自动重启，再只发送 SIGTERM 并观察退出。停止超时不发送 SIGKILL，保留容器和禁用的 restart policy，以免自动重启重新开放旧进程准入。rollback/restart 只有在恢复 readiness 后才恢复保存的策略。状态目录及保留容器/镜像应一起保留；异常处理中需要人工确认这些策略，不能单独删除部署状态。

### 首发迁移与旧版本回滚

旧版本 `e868f59` 没有 health lifecycle 字段，不能自动排空。首发切流后，脚本读取旧实例状态会 fail closed、保留旧容器并报失败；这不表示新色切流已撤销。回滚到该旧镜像时，恢复流程同样无法确认 lifecycle/resume，因而在切回 Caddy 前失败；此时旧容器可能已经启动，脚本不宣称自动支持无 lifecycle 的版本。

首次迁移或旧版本回滚需安排受控窗口，由可信操作者阻断新 Gateway 准入，并人工验证旧实例的活动模型请求、usage 持久化、结算尝试及失败记录均已收尾，再决定停止旧容器或切回旧版本。旧版本没有本轮持久补偿保障；连接数归零、固定等待预算 + grace、HTTP 响应结束都不能单独证明其计费收尾完成。新版本只要求请求的有界持久化和清理结束，后台待结算记录须保留并由兼容版本继续补偿；回滚到旧代码不会处理这些新记录，需单独安排补偿。证据不足时继续保留实例并报未完成，不能绕过脚本检查强杀。回滚到旧版本还会失去本轮自动排空保障，后续停止仍需人工验证。保留容器、原镜像和部署状态目录，勿在确认前重建或覆盖。

边界：本契约只保障 Gateway 的已登记请求，不保证队列任务、后台账单补偿、WebSocket 或其他 HTTP 请求已经全部完成。控制器阶段的数据库/Redis 等待各有 5 秒预算，超时不代表底层操作被取消，也不虚报持久化成功；已有执行记录保留待恢复/对账，后台扣费卡住不阻止 HTTP 活动数归零。守卫/入口阶段仍依赖基础设施超时，未计入 controller 活动数；其他活动请求无法结束或状态探测失败时，排空明确失败并保留实例。旧版本没有 lifecycle 字段时安全失败，保留旧实例，首次升级必须另行安排受控窗口，不能退回固定 sleep。OOM、宿主机断电、Docker daemon 卡死、显式 SIGKILL 或人工 `docker compose stop/down/up --force-recreate` 不在保证范围内。Compose 的停止超时仍可触发强杀，不能把它当作发布排空入口；正常操作统一用此脚本。

本地验证只运行 mocks，不连接 Docker daemon，不执行部署：

```bash
bash deploy/production/test-sep-deploy.sh
bash deploy/production/test-sep-drain.sh
node deploy/production/test-sep-compose.cjs
pnpm --dir backend exec jest --runInBand common/lifecycle health/health.controller.spec.ts
```

## 故障恢复

```bash
cd /opt/sep/app/deploy/production

# 先确认共享基础设施仍在运行
./sep-deploy.sh status

# 若数据库刚恢复，先观察迁移容器日志，再重新发布 SEP
docker logs --tail=100 sep-migrate
./sep-deploy.sh deploy-backend
```

不要执行以下操作：

```bash
docker compose down                          # 可能影响共享项目
docker stop longdao-postgres* longdao-redis  # 会影响中转站
docker rm longdao-postgres*                  # 可能造成数据不可恢复
```

---

## 资源占用（预期）

| 容器 | 内存 |
|------|------|
| sep-backend | ~200-400MB |
| sep-web | ~150-300MB |
| Ollama + bge-m3 | 需按服务器实测预留，不计入 SEP Web/Backend 配额 |
| **SEP 应用新增合计** | **~500MB，不含 Ollama 与 PostgreSQL** |
