# SEP 知识库设计与技术栈说明

## 1. 一句话概览

SEP 的知识库设计成一个**企业隔离的 RAG 知识库**：

```text
企业创建知识库
  -> 上传文档
  -> 异步解析、清洗、分块
  -> 生成 Embedding 和词法索引
  -> 按员工订阅/部门授权检索
  -> 将检索结果注入员工会话
  -> 由大模型生成最终回答
```

当前实现不依赖独立向量数据库：PostgreSQL + pgvector 保存知识数据和向量，HNSW 索引执行数据库内余弦检索，NestJS 负责权限、检索编排与结果融合，Redis/BullMQ 负责异步文档处理。

核心代码目录：

- `backend/src/modules/knowledge/`
- `backend/src/modules/conversation/conversation-stream.service.ts`
- `backend/prisma/schema.prisma`
- `web/src/features/knowledge/`

## 2. 整体架构

```text
企业管理员
   |
   | 创建知识库、上传文档、编辑片段、配置授权
   v
Knowledge Base API（NestJS）
   |
   +--> PostgreSQL + pgvector：知识库、文档、文本块、向量、授权、检索日志
   |
   +--> 本地文件系统：原始上传文件
   |
   +--> Redis + BullMQ：文档处理队列
                    |
                    v
             文档处理 Worker
                    |
                    +--> 解析文件
                    +--> 文本清洗
                    +--> 文本分块
                    +--> 中文分词
                    +--> Embedding
                    +--> 写入 TextChunk

员工会话
   |
   v
根据用户企业、员工订阅和部门授权计算可访问知识库
   |
   v
词法检索 / 向量检索 / 混合检索
   |
   v
知识上下文 + 用户问题 -> sub2api -> 大模型回答
```

## 3. 数据模型

知识库相关模型定义在 `backend/prisma/schema.prisma`。

| 模型 | 作用 |
|---|---|
| `KnowledgeBase` | 企业知识库，归属于一个企业 |
| `Document` | 原始上传文件、处理状态和错误信息 |
| `TextChunk` | 文档分块后的可检索文本 |
| `KnowledgeGrant` | 知识库对员工订阅或部门的授权关系 |
| `KnowledgeSearchLog` | 检索次数、命中数、最高分、策略和耗时 |
| `KnowledgeUsageLog` | 会话使用知识库的记录 |

### 3.1 `KnowledgeBase`

知识库属于企业，并记录创建者。知识库删除时，关联文档、文本块、授权和日志通过数据库级联关系清理。

主要字段：

- `enterpriseId`
- `name`
- `description`
- `createdBy`
- `createdAt`
- `updatedAt`

### 3.2 `Document`

文档保存原始文件元数据和异步处理状态：

- `filename`：服务端生成的唯一文件名
- `originalName`：用户上传时的文件名
- `storagePath`：服务端内部文件路径
- `mimeType`
- `fileSize`
- `status`
- `lastError`
- `processedAt`
- `embeddingModel`
- `version`

文档状态：

```text
PENDING -> PROCESSING -> READY
                    \\-> FAILED
```

- `PENDING`：记录已创建，等待队列处理。
- `PROCESSING`：Worker 正在解析、分块或向量化。
- `READY`：文本块已经生成，可检索。
- `FAILED`：处理失败，`lastError` 保存错误原因，可重新处理。

### 3.3 `TextChunk`

`TextChunk` 是实际检索单位，主要字段包括：

- `knowledgeBaseId`
- `documentId`
- `content`
- `source`
- `tags`
- `tokens`
- `embedding`：旧版 BYTEA 兼容列
- `embeddingVector`：pgvector `vector(1024)` 正式向量列
- `embeddingModel`
- `createdBy`

向量正式保存为 PostgreSQL pgvector `vector(1024)`，并保留 `BYTEA` 兼容列用于迁移期有限回退；词法检索使用预先保存的 `tokens`。新写入和 reindex 会同步更新兼容列与 pgvector 列。

### 3.4 `KnowledgeGrant`

授权对象支持两个维度：

- `subscriptionId`：授权给某段员工订阅关系。
- `departmentId`：授权给某个部门。

检索前会同时校验：

1. 当前用户属于哪个企业；
2. 当前 `subscriptionId` 是否属于该企业；
3. 当前员工订阅和部门是否拥有知识库授权。

当前代码支持订阅级授权、订阅 + 部门授权以及部门级授权。产品层面应继续保持授权语义的一致，避免前端和后端对“订阅授权”和“部门授权”的组合关系理解不同。

## 4. 文档上传和处理流程

实现位置：

- `backend/src/modules/knowledge/document.service.ts`
- `backend/src/modules/knowledge/document-processor.service.ts`
- `backend/src/modules/knowledge/knowledge-queue.service.ts`

### 4.1 上传阶段

1. 企业管理员上传文件。
2. 校验企业和知识库权限。
3. 校验文件类型和大小。
4. 文件保存到 `UPLOAD_PATH/knowledge`。
5. 创建 `PENDING` 文档记录。
6. 将 `documentId` 加入 BullMQ 队列。
7. 请求立即返回文档元数据，不等待全文处理完成。

当前支持的文件类型：

- PDF
- DOCX / DOC
- TXT
- Markdown
- PNG
- JPEG

单个文件大小上限目前为 10MB。

### 4.2 异步处理阶段

Worker 默认并发数为 2，处理步骤如下：

1. 将文档状态更新为 `PROCESSING`。
2. 使用解析器提取文本。
3. 清洗文本和空白字符。
4. 按段落切分文本，默认块大小约 1000 字符。
5. 对每个文本块进行中文分词。
6. 调用 Embedding 服务生成向量。
7. 将文本、tokens、向量、模型名写入 `TextChunk`。
8. 将文档更新为 `READY`。

队列能力包括：

- 失败自动重试 3 次；
- 指数退避；
- 清理最近完成和失败任务；
- 服务重启后恢复卡在 `PROCESSING` 超过 10 分钟的文档；
- 重处理前删除旧文本块，保证幂等。

### 4.3 Embedding 不可用时的降级

如果 Embedding 服务不可用，系统目前不会阻断文档上传，而是：

- 保存文本块和词法 tokens；
- 不保存向量；
- 文档仍进入 `READY`；
- `lastError` 记录“降级为仅词法检索”；
- 后续检索自动使用词法模式。

企业端应明确显示这种状态，避免用户误以为文档已经完成完整的向量化处理。

## 5. 检索设计

检索服务位于 `backend/src/modules/knowledge/knowledge-search.service.ts`，支持以下策略：

```text
lexical  词法检索
vector   向量检索
hybrid   混合检索
auto     自动选择
```

### 5.1 权限过滤优先于检索

检索顺序是：

```text
解析当前用户企业上下文
  -> 校验 subscriptionId 属于当前企业
  -> 查询当前订阅/部门授权的知识库
  -> 只在授权知识库中执行检索
```

因此，检索服务不会只相信请求体中的知识库 ID，而是先通过用户身份和企业上下文计算允许的知识库集合。

### 5.2 词法检索

词法检索采用两阶段方案：

```text
PostgreSQL pg_trgm 相似度召回
        -> BM25 打分和排序
```

具体技术：

- PostgreSQL `pg_trgm` 的 `similarity()` 函数；
- Node.js `Intl.Segmenter` 中文分词；
- BM25 评分；
- 召回候选后取 Top K。

词法检索不依赖 Embedding 服务，因此可以作为降级方案运行。

### 5.3 向量检索

当前使用 PostgreSQL pgvector，不需要 Elasticsearch、Milvus 或其他独立向量数据库。正式检索路径是：

```text
查询文本 -> Ollama bge-m3 生成 1024 维向量
        -> PostgreSQL pgvector 余弦距离
        -> HNSW 索引召回 Top K
```

`VectorService` 负责：

- 校验查询向量必须为 1024 维；
- 在企业和已授权知识库范围内执行 pgvector 查询；
- 返回 Top K 文本块；
- 写入和清理文本块的 pgvector 向量；
- 暴露 pgvector 成功、兼容回退和失败计数。

仅当数据库尚未完成 pgvector 迁移时，系统才允许对有上限的候选集使用旧版 BYTEA + Node.js 余弦计算兼容回退。非迁移类 pgvector 异常不会被静默降级，候选量超过上限也会明确失败，避免生产环境意外进入 O(N) 扫描。

### 5.4 混合检索

混合检索并行执行词法检索和向量检索，再使用 RRF（Reciprocal Rank Fusion）融合两个结果集：

```text
BM25 结果 + 向量结果
          -> RRF 排名融合
          -> Top K
```

`auto` 策略当前规则为：

- Embedding 可用：使用 `hybrid`；
- Embedding 不可用：降级为 `lexical`。

## 6. 会话 RAG 流程

会话 RAG 实现在 `backend/src/modules/conversation/conversation-stream.service.ts`。

只有以下条件同时满足时才检索知识库：

- 当前会话存在员工订阅关系；
- 用户消息有非空文本；
- 当前用户可以访问该订阅关系；
- 订阅关系拥有知识库授权。

执行过程：

1. 用户向硅基员工提问。
2. 根据 `subscriptionId` 获取授权知识库集合。
3. 对用户问题生成检索请求。
4. 默认检索最多 3 个文本块，默认相似度阈值为 0.7。
5. 将文本块内容、来源文件和相似度拼接成知识上下文。
6. 将知识上下文加入大模型输入。
7. 将检索来源保存到消息的 `knowledgeSources` 字段。
8. 大模型通过 sub2api 生成最终回答。

知识检索异常目前不会阻断主会话，只会记录错误并继续调用模型。这适合保障会话可用性，但生产环境应根据企业安全要求决定是否允许“检索失败后继续回答”。

## 7. Embedding 设计

实现位置：`backend/src/modules/knowledge/embedding.service.ts`。

代码仍保留多个 provider 适配器，但当前正式部署只使用 Ollama 的 OpenAI-compatible 接口：

| Provider | 调用方式 | 适用场景 |
|---|---|---|
| `openai` | `POST /v1/embeddings` | 当前正式方案：Ollama `bge-m3:latest` |
| 其他适配器 | 兼容旧实现 | 不作为当前生产部署方案 |

环境变量：

```dotenv
EMBEDDING_PROVIDER=
EMBEDDING_BASE_URL=
EMBEDDING_MODEL=
EMBEDDING_DIMENSION=
EMBEDDING_API_KEY=
EMBEDDING_BATCH_SIZE=
EMBEDDING_TIMEOUT_MS=
```

代码会校验返回向量维度，配置维度和模型实际维度不一致时会直接报错。

本地默认配置是：

```dotenv
EMBEDDING_PROVIDER=openai
EMBEDDING_BASE_URL=http://127.0.0.1:11434/v1
EMBEDDING_MODEL=bge-m3:latest
EMBEDDING_API_KEY=ollama-local
EMBEDDING_DIMENSION=1024
EMBEDDING_BATCH_SIZE=32
EMBEDDING_TIMEOUT_MS=120000
```

生产容器必须显式配置 Docker 网络可访问的 Ollama 地址，例如 `http://sep-ollama:11434/v1`，不能使用容器自身的 `127.0.0.1`。代码无需 Ollama 专用 provider，因为 Ollama 已提供 OpenAI-compatible 接口。切换模型后必须调用知识库 reindex 重建历史向量。

## 8. 技术栈

### 后端

- TypeScript
- NestJS 10
- Prisma 6
- PostgreSQL 16
- pgvector + HNSW
- Redis 7
- BullMQ
- Jest

### 文档解析和文本处理

- `pdf-parse`：PDF 文本提取
- `mammoth`：DOCX 文本提取
- Node.js 文件系统：TXT / Markdown 读取
- `tesseract.js`：图片 OCR
- `Intl.Segmenter`：中文分词和分句

### 检索

- PostgreSQL `pg_trgm`、pgvector
- BM25
- HNSW 余弦检索
- RRF 混合排序
- 有上限的旧版 BYTEA 兼容回退

### 前端

- Next.js 15
- App Router
- React
- TanStack Query

企业端知识库页面已经包含：

- 知识库列表；
- 知识库创建、编辑和删除；
- 文档上传；
- 文档处理状态；
- 文本片段查看和编辑；
- 知识库授权；
- 检索测试；
- 检索分析。

## 9. 日志和分析

系统会记录知识库检索日志，包括：

- 查询内容；
- Top K；
- 命中数量；
- 最高分；
- 实际检索策略；
- 是否来自测试工具；
- 检索耗时；
- 企业和知识库 ID。

企业端可以基于这些数据查看：

- 总检索次数；
- 测试检索和真实会话检索；
- 平均命中数量；
- 平均最高分；
- 零命中率；
- 零命中查询；
- 最近检索记录；
- 当前 Embedding 服务是否可用。

## 10. 当前设计边界

### 已具备的能力

- 企业级知识库隔离；
- 员工订阅和部门授权；
- 异步文档处理；
- PDF、Word、TXT、Markdown 和图片处理；
- 向量、词法和混合检索；
- Embedding 不可用时词法降级；
- 会话 RAG；
- 知识来源保存；
- 检索日志和分析页面；
- 失败文档重试和卡死任务恢复。

### 当前技术边界

1. pgvector 当前固定为 1024 维，切换到其他维度需要数据库迁移和全量 reindex。
2. 旧版 BYTEA 仅用于迁移兼容，不应成为长期生产检索路径。
3. 原始文件目前依赖本地磁盘，不是对象存储。
4. 生产环境必须单独部署 Ollama，并监控模型服务健康与延迟。
5. Embedding 模型更换后需要重新处理历史文档。
6. 文档无向量时仍可能处于 `READY`，前端必须清楚展示 lexical-only 降级状态。
7. 会话检索失败目前不会阻断对话，需要根据企业安全等级决定是否改成阻断策略。
8. 知识库内容应作为参考资料使用，不能被当作系统级指令直接执行。

## 11. 当前适用范围和后续升级方向

目前这套方案适合：

- SEP MVP；
- 内部企业灰度；
- 从中小规模增长到较大规模的企业知识库；
- 需要在 PostgreSQL 内保持租户过滤与向量检索一致性的场景。

后续规模扩大时，建议按以下顺序升级：

1. 将本地文件迁移到对象存储，并增加备份和生命周期管理。
2. 增加检索质量评估集和召回率、零命中率监控。
3. 按生产数据量调优 HNSW 参数、批处理并发和数据库资源。
4. 当单库规模或隔离需求超过 PostgreSQL 承载范围时，再评估独立向量数据库。
5. 根据企业安全策略决定检索失败时是降级回答还是阻断会话。

总体判断：当前实现是一套 PostgreSQL pgvector + Redis/BullMQ + Ollama bge-m3 的企业隔离混合检索方案。向量检索已从应用层暴力计算升级为数据库 HNSW；下一阶段重点是服务器 Ollama 部署、对象存储和真实负载下的容量调优。
