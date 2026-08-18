# Embedding 服务部署指南

## 概述

知识库向量化依赖 Embedding 服务，用于将文本转换为向量进行相似度检索。

## 架构限制

### ARM64 (Apple Silicon) 不支持本地推理

当前主流 Embedding 推理框架**均不支持 ARM64**：

| 方案 | x86_64 | ARM64 | 说明 |
|------|--------|-------|------|
| HuggingFace TEI | ✅ | ❌ | 官方镜像仅编译 x86_64 |
| Infinity Server | ✅ | ❌ | michaelf34/infinity 无 ARM64 镜像 |
| llama.cpp | ✅ | ⚠️  | 需手动编译，官方无预构建镜像 |

**影响**：
- 开发环境（M 系列 Mac）无法启动本地 Embedding 容器
- 必须使用远程 API（sub2api / OpenAI）

---

## 配置方案

### 方案 A：开发环境（ARM64 Mac）

使用 **sub2api** 的 `text-embedding-3-small` 模型（会消耗 token）。

**backend/.env**：
```bash
EMBEDDING_PROVIDER=openai
EMBEDDING_BASE_URL=https://longdaoai.cn/v1
EMBEDDING_MODEL=text-embedding-3-small
EMBEDDING_DIMENSION=1536
```

**成本**：
- $0.00002 / 1K tokens
- 10MB 文档 ≈ 300K tokens ≈ $0.006

---

### 方案 B：生产环境（x86_64 Linux）

使用 **Infinity Server** 本地推理（免费，无外部依赖）。

#### 1. 取消 docker-compose.yml 的注释

```yaml
embedding:
  image: michaelf34/infinity:latest
  container_name: sep-embedding
  platform: linux/amd64
  command: v2 --model-id BAAI/bge-small-zh-v1.5 --port 8080
  ports:
    - "8080:8080"
  volumes:
    - embedding_models:/app/.cache
  environment:
    - HF_HOME=/app/.cache
  deploy:
    resources:
      limits:
        memory: 1G
```

#### 2. 更新 backend/.env

```bash
EMBEDDING_PROVIDER=openai
EMBEDDING_BASE_URL=http://localhost:8080  # 或 http://embedding:8080 (compose 内网)
EMBEDDING_MODEL=BAAI/bge-small-zh-v1.5
EMBEDDING_DIMENSION=512
```

#### 3. 启动容器

```bash
docker-compose up -d embedding

# 检查健康状态（首次启动需下载 4.4GB 模型，约 2-5 分钟）
docker-compose logs -f embedding

# 验证 API
curl http://localhost:8080/health
curl -X POST http://localhost:8080/embeddings \
  -H "Content-Type: application/json" \
  -d '{"input": "测试文本", "model": "BAAI/bge-small-zh-v1.5"}'
```

---

## 模型选择

| 模型 | 维度 | 大小 | 性能 | 适用场景 |
|------|------|------|------|----------|
| BAAI/bge-small-zh-v1.5 | 512 | 100MB | 快 | 开发/小规模 |
| BAAI/bge-base-zh-v1.5 | 768 | 400MB | 中 | 生产推荐 |
| BAAI/bge-large-zh-v1.5 | 1024 | 1.3GB | 慢 | 高精度场景 |
| text-embedding-3-small | 1536 | API | - | 开发环境降级 |

---

## 环境变量完整参考

```bash
# Provider 类型（openai / tei / wasm）
EMBEDDING_PROVIDER=openai

# API 端点
EMBEDDING_BASE_URL=http://localhost:8080

# 模型 ID（需与容器启动参数一致）
EMBEDDING_MODEL=BAAI/bge-small-zh-v1.5

# 向量维度（需与模型实际维度匹配）
EMBEDDING_DIMENSION=512
```

---

## 故障排查

### 容器无法启动

**症状**：`docker-compose up -d embedding` 报错 `does not provide the specified platform (linux/arm64)`

**原因**：Infinity 镜像无 ARM64 版本

**解决**：
1. 检查 `platform: linux/amd64` 是否正确设置
2. ARM64 机器改用方案 A（sub2api）
3. 或部署到 x86_64 云服务器

### 后端连接失败

**症状**：`KnowledgeService` 报错 `connect ECONNREFUSED`

**排查**：
```bash
# 1. 检查容器状态
docker-compose ps embedding

# 2. 检查健康检查
docker inspect sep-embedding | grep -A 5 Health

# 3. 检查端口映射
docker-compose port embedding 8080

# 4. 手动测试 API
curl http://localhost:8080/health
```

**常见原因**：
- 容器未启动：`docker-compose up -d embedding`
- 端口占用：`lsof -i :8080` 检查冲突
- 网络隔离：backend 容器内使用 `http://embedding:8080` 而非 `localhost`

---

## 性能优化

### 内存限制

默认限制 1GB，大模型需调整：

```yaml
deploy:
  resources:
    limits:
      memory: 2G  # bge-large-zh-v1.5 需要
```

### 批量优化

Infinity 支持批量请求，前端建议批量上传：

```typescript
// ❌ 逐个上传
for (const file of files) {
  await uploadDocument(file)
}

// ✅ 批量上传
await uploadDocuments(files)  // 后端内部批量调用 embedding API
```

---

## 后续优化方向

1. **ARM64 支持**：关注 llama.cpp 的预构建 Docker 镜像
2. **模型升级**：生产环境切换到 `bge-base-zh-v1.5`（维度 768，性能更优）
3. **GPU 加速**：x86_64 + NVIDIA GPU 可用 TEI 官方镜像
4. **缓存优化**：高频查询文本的 embedding 结果缓存到 Redis

---

## 相关文档

- [知识库生产化计划](../plans/2026-08-17-knowledge-production-plan.md)
- [Infinity Server 文档](https://github.com/michaelfeil/infinity)
- [BGE 模型仓库](https://huggingface.co/BAAI/bge-small-zh-v1.5)
