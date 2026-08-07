# SEP 部署到服务器 — 操作手册

## 前提条件

- 服务器 `64.83.39.223` 已运行 longdao（postgres / redis / sub2api / caddy）
- 你有一个域名，DNS A 记录已指向 `64.83.39.223`
- 本地 SEP 代码已推送到 GitHub

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

---

## 步骤二：创建 SEP 数据库

```bash
# 在 longdao-postgres 容器内创建独立数据库
docker exec -it longdao-postgres psql \
  -U sub2api \
  -c "CREATE DATABASE sep_prod;"

# 验证
docker exec longdao-postgres psql -U sub2api -c "\l" | grep sep
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

# 构建镜像（首次约 3-5 分钟）
docker compose --env-file /opt/sep/.env build

# 启动服务
docker compose --env-file /opt/sep/.env up -d

# 查看启动日志
docker compose --env-file /opt/sep/.env logs -f
```

---

## 步骤六：验证

```bash
# 检查容器状态
docker ps | grep sep

# 检查 backend 健康
curl http://localhost:3001/health

# 检查 web
curl -I https://你的域名
```

---

## 日常维护

```bash
# 更新代码并重新部署
cd /opt/sep/app
git pull
cd deploy/production
docker compose --env-file /opt/sep/.env up -d --build

# 查看日志
docker logs sep-backend -f
docker logs sep-web -f

# 停止
docker compose --env-file /opt/sep/.env down
```

---

## 资源占用（预期）

| 容器 | 内存 |
|------|------|
| sep-backend | ~200-400MB |
| sep-web | ~150-300MB |
| **新增合计** | **~500MB** |
| 服务器可用 | 2.8GB → 约 2.3GB 剩余 |
