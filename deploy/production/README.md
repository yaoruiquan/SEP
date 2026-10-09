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
docker stop sep-backend sep-web 2>/dev/null || true
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

脚本会用该 SHA 生成默认镜像标签（短 SHA），并拒绝部署到不同 checkout。候选色会同时启动后端和前端，readiness 通过后 Caddy 的 Web 与 `/ws/*` upstream 一起切换；旧色会在发布后观察期和排空时间内保持运行。观察失败时脚本会自动切回旧色并停止候选色，Caddy reload 或配置校验失败也会恢复切换前的备份。

每次部署启动候选后端前，脚本会检查共享 `sep_uploads` 卷，将上传目录修正为 `node` 用户可写，并用 `node` 用户实际执行临时写入/删除验证。候选环境的 readiness 也会再次做写入检查；失败时不会切换 Caddy。生产本地存储路径固定为 `/app/uploads/chat`。

观察通过后才会停止旧色。手动回滚使用：

```bash
./sep-deploy.sh rollback-bluegreen
```

`deploy/production/test-sep-deploy.sh` 是 mock-only 回归测试，不连接 Docker daemon，不执行真实发布。

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
