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
- `JWT_SECRET` — `openssl rand -hex 32`
- `SUB2API_API_KEY` — 在 sub2api 管理后台新建一个渠道 key
- `EMBEDDING_BASE_URL` — Ollama 在 Docker 网络中的地址，例如 `http://sep-ollama:11434/v1`

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
./sep-deploy.sh deploy

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
./sep-deploy.sh deploy

# 查看日志
./sep-deploy.sh logs sep-backend
./sep-deploy.sh logs sep-web

# 停止 SEP 应用（不会停止共享 PostgreSQL、Redis 或 Caddy）
docker stop sep-backend sep-web 2>/dev/null || true
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
