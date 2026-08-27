# Embedding 服务部署指南

本项目当前正式方案是：**独立部署 Ollama，加载 `bge-m3:latest`，通过 OpenAI-compatible `/v1/embeddings` 提供向量服务**。SEP 后端使用 `openai` provider 访问它；PostgreSQL 使用 pgvector 保存 1024 维向量并执行 HNSW 余弦检索。

## 1. 架构与边界

```text
SEP backend  --HTTP-->  Ollama :11434/v1/embeddings
       |
       +---------------> PostgreSQL pgvector (vector(1024), HNSW)
```

Ollama 是独立服务，可以与 SEP 部署在同一台服务器或独立机器。不要在生产环境依赖后端容器内的 `localhost`，也不要把大模型中转服务当作 Embedding 服务。

## 2. Ollama 部署

在目标服务器安装 Ollama 后执行：

```bash
ollama pull bge-m3:latest
ollama list
```

验证 OpenAI-compatible 接口：

```bash
curl http://127.0.0.1:11434/api/tags
curl -X POST http://127.0.0.1:11434/v1/embeddings \
  -H 'Content-Type: application/json' \
  -d '{"model":"bge-m3:latest","input":"测试知识库向量化"}'
```

响应中的向量长度必须是 **1024**。如果 SEP 在 Docker 中运行，需让 Ollama 监听可被容器访问的地址，并把 `EMBEDDING_BASE_URL` 配成 Docker 网络可达的地址，例如 `http://sep-ollama:11434/v1`。

## 3. SEP 环境变量

### 后端与 Ollama 同机、后端直接运行

```dotenv
EMBEDDING_PROVIDER=openai
EMBEDDING_BASE_URL=http://127.0.0.1:11434/v1
EMBEDDING_MODEL=bge-m3:latest
EMBEDDING_API_KEY=ollama-local
EMBEDDING_DIMENSION=1024
EMBEDDING_BATCH_SIZE=32
EMBEDDING_TIMEOUT_MS=120000
```

### 后端容器访问 Ollama

```dotenv
EMBEDDING_PROVIDER=openai
EMBEDDING_BASE_URL=http://sep-ollama:11434/v1
EMBEDDING_MODEL=bge-m3:latest
EMBEDDING_API_KEY=ollama-local
EMBEDDING_DIMENSION=1024
```

`EMBEDDING_BASE_URL` 可以带 `/v1`。代码会规范化地址并只请求一次 `/v1/embeddings`。模型切换后必须对历史文档执行知识库 `reindex`，不能混用不同模型或维度的向量。

## 4. PostgreSQL 与迁移

生产数据库必须使用 `pgvector/pgvector:pg16` 或已安装 pgvector 扩展的 PostgreSQL。发布时执行：

```bash
pnpm --filter backend exec prisma migrate deploy
pnpm --filter backend exec prisma generate
```

确认扩展、向量列和 HNSW 索引：

```sql
SELECT extname FROM pg_extension WHERE extname = 'vector';
SELECT column_name, udt_name FROM information_schema.columns
  WHERE table_name = 'text_chunks' AND column_name = 'embeddingVector';
SELECT indexname FROM pg_indexes
  WHERE tablename = 'text_chunks' AND indexname LIKE '%hnsw%';
```

## 5. 发布验收

1. `ollama list` 显示 `bge-m3:latest`。
2. `/v1/embeddings` 单条和批量请求均返回 1024 维。
3. SEP 启动日志显示 `provider=openai, model=bge-m3:latest, dimension=1024`。
4. 上传 TXT/Markdown 文档，状态从 `PENDING`/`PROCESSING` 变为 `READY`。
5. `TextChunk.embeddingModel` 为 `bge-m3:latest`，`embeddingVector` 非空。
6. 执行向量或混合检索，确认结果受企业和订阅授权过滤。
7. 已有知识库调用 `POST /api/knowledge-bases/{knowledgeBaseId}/reindex` 重建向量。

## 6. 故障排查

### `ECONNREFUSED`

- 检查 Ollama：`curl http://127.0.0.1:11434/api/tags`。
- 后端容器内不要使用 `127.0.0.1`，改用 Docker 网络中的 Ollama 服务名或内网地址。
- 检查防火墙和 Ollama 监听地址。

### 维度不匹配

确保 `EMBEDDING_DIMENSION=1024`，模型为 `bge-m3:latest`。不要沿用其他模型的维度；修改模型后必须完成 reindex。

### 文档只有词法检索

查看文档处理错误和后端日志，确认 Ollama 可用、pgvector 迁移已执行。系统可以在 Embedding 暂时不可用时降级为词法检索，但企业端必须显示降级状态。

## 7. 相关文档

- [知识库第二阶段 pgvector + bge-m3 升级方案](../plans/知识库第二阶段-pgvector-bge-m3本地升级.md)
- [生产 Compose](../../deploy/production/docker-compose.yml)
- [知识库设计与技术栈](../对接/SEP知识库设计与技术栈说明.md)
