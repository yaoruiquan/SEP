# 知识库第二阶段本地升级：pgvector + bge-m3

## 目标

在数据量增长前完成可验证的本地知识库闭环：使用 Ollama 的 `bge-m3:latest` 生成 1024 维向量，PostgreSQL 通过 pgvector 的 HNSW 索引执行向量检索，保留现有 BM25/混合检索和企业授权边界。

## 本阶段范围

- PostgreSQL 16 使用 `pgvector/pgvector:pg16`。
- `text_chunks.embeddingVector vector(1024)` 与余弦 HNSW 索引。
- Embedding 请求通过 Ollama OpenAI-compatible API：`http://127.0.0.1:11434/v1`。
- embedding 批量大小、超时、返回维度校验和真实可用性检查。
- 新写入文档/手工片段同时写入兼容 BYTEA 与 pgvector。
- 向量检索优先走 pgvector，迁移未完成时回退 BYTEA；缓存按 embedding 模型隔离。
- 企业管理员可调用 `POST /api/knowledge-bases/:id/reindex` 重建知识库向量。

## 本地运行

```bash
docker compose -f docker-compose.knowledge-pgvector.yml up -d
pnpm install --offline
pnpm --filter backend db:generate
pnpm --filter backend exec prisma migrate deploy
pnpm --filter backend dev
```

独立环境端口：PostgreSQL `55432`、Redis `56379`、后端 `3101`。主环境的 `5432/6379/3000/3001` 不会被占用。Ollama 需要已安装并可访问 `bge-m3:latest`。

## 数据迁移与历史数据

迁移只新增 pgvector 列，不会把旧模型的 BYTEA 强制转换为新向量。对历史片段调用重建接口，服务会使用当前模型重新生成并更新两种存储；失败片段保留原数据并在结果中统计。

## 验收标准

1. `SELECT extname FROM pg_extension` 返回 `vector`，HNSW 索引存在。
2. Ollama `/v1/embeddings` 对 `bge-m3:latest` 返回 1024 维向量。
3. 文档处理后 `embedding`、`embeddingModel`、`embeddingVector` 均有值。
4. 向量/混合检索命中授权知识库，未授权订阅无结果。
5. 模型不可用时仅降级为词法检索，不影响文本入库。
6. 重建接口仅限企业管理员且不会跨企业访问知识库。
