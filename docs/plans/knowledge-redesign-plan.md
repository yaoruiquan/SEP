# 知识库系统重设计方案 v2

> **历史设计，已被替代，禁止用于部署。** 当前正式方案是 Ollama `bge-m3:latest`（1024 维）+ PostgreSQL pgvector/HNSW；本文旧模型服务、WASM 回退和 BYTEA 主检索设计仅用于追溯。请使用[当前部署指南](../deployment/embedding-service.md)。

## 目标

硅基员工提问时，在 200-500ms 内从企业文档中检索相关段落，绝对不能泄露其他企业数据。

## 约束

- 4GB RAM（1.3GB 可用），2 核 CPU
- Postgres 与 sub2api 共用，不能动镜像（不装 pgvector/zhparser）
- 嵌入模型必须独立于 sub2api（独立容器部署）
- 每企业 ~10-1000 个文档 → ~20k chunks
- Node.js v26.5 自带 Intl.Segmenter 支持中文分词

## 核心架构

### 三层检索系统

```
┌─────────────────────────────────────────────────────────┐
│  Layer 3: Hybrid Fusion (RRF)                          │
│  输入：lexical_ranks + vector_ranks → 输出：merged_top_k │
└─────────────────────────────────────────────────────────┘
              ▲                          ▲
              │                          │
┌─────────────┴──────────────┐  ┌───────┴──────────────────┐
│ Layer 1: Lexical (BM25)    │  │ Layer 2: Dense Vector    │
│ - Intl.Segmenter 分词      │  │ - TEI 容器 embedding     │
│ - pg_trgm 候选召回         │  │ - bytea 存储向量         │
│ - BM25 打分（Node 内）     │  │ - 内存 LRU 缓存          │
│ - 始终可用（零依赖）       │  │ - brute-force cosine     │
└────────────────────────────┘  └──────────────────────────┘
              ▲                          ▲
              └──────────┬───────────────┘
                         │
            ┌────────────┴────────────────┐
            │ Layer 0: Auth Boundary      │
            │ WHERE enterpriseId = ?      │
            │   AND kb_id IN (granted)    │
            └─────────────────────────────┘
```

### 安全边界（Layer 0）

**原则**：SQL 层强制隔离，绝不依赖应用逻辑

```typescript
// 1. 从 JWT 或 session 获取 userId
// 2. 通过 userId → instance → template → enterpriseId
const instance = await prisma.digitalEmployeeInstance.findUnique({
  where: { id: instanceId },
  include: { template: { select: { enterpriseId: true } } }
});

const enterpriseId = instance.template.enterpriseId;

// 3. 获取授权的知识库（必须属于同一企业）
const grants = await prisma.knowledgeGrant.findMany({
  where: { 
    instanceId,
    knowledgeBase: { enterpriseId }  // 企业前置过滤
  },
  select: { knowledgeBaseId: true }
});

const kbIds = grants.map(g => g.knowledgeBaseId);

// 4. 所有检索查询都带双重过滤
const chunks = await prisma.textChunk.findMany({
  where: {
    knowledgeBase: { 
      enterpriseId,           // 防御性：企业隔离
      id: { in: kbIds }       // 授权过滤
    }
  }
});
```

**防御措施**：
- ✅ 即使攻击者伪造 instanceId，也会被 enterpriseId 过滤拦截
- ✅ 所有 WHERE 条件都包含 enterpriseId，Postgres 查询计划强制隔离
- ✅ 索引设计：`(enterpriseId, knowledgeBaseId, ...)` 确保查询高效

---

## 技术栈选型

### 1. Embedding 模型部署

**方案**：Text Embeddings Inference (TEI) 独立容器

```yaml
# docker-compose.yml 新增
embedding:
  image: ghcr.io/huggingface/text-embeddings-inference:1.5
  command: --model-id BAAI/bge-small-zh-v1.5 --port 8080
  ports:
    - "8080:8080"
  deploy:
    resources:
      limits:
        memory: 512M
        cpus: '1'
```

**环境变量**：
```bash
EMBEDDING_PROVIDER=tei          # tei | wasm | openai (可降级)
EMBEDDING_BASE_URL=http://embedding:8080
EMBEDDING_MODEL=BAAI/bge-small-zh-v1.5
EMBEDDING_DIMENSION=1024        # bge-small 输出维度
```

**性能指标**：
- 单文本 embedding: 20-50ms
- 批处理 (100 texts): 500-1000ms
- 内存占用: ~400MB

**降级策略**：
```typescript
// 优先 TEI，失败自动降级到 transformers.js WASM
if (!await testTEIConnection()) {
  logger.warn('TEI unavailable, fallback to WASM');
  embedder = await pipeline('feature-extraction', 'Xenova/bge-small-zh-v1.5');
}
```

### 2. 向量存储与检索

**存储方案**：Postgres bytea + 内存 LRU 缓存

```sql
-- text_chunks 表新增字段
ALTER TABLE text_chunks 
ADD COLUMN embedding BYTEA,           -- Float32Array 序列化
ADD COLUMN embedding_model VARCHAR(100);
```

**内存缓存设计**：
```typescript
import LRU from 'lru-cache';

// 缓存配置：最多 5 个企业的向量数据
const vectorCache = new LRU<string, Float32Array[]>({
  max: 5,                                    // 最多 5 个企业
  maxSize: 600 * 1024 * 1024,               // 600MB
  sizeCalculation: (vectors) => {
    return vectors.length * vectors[0].length * 4;  // Float32 = 4 bytes
  }
});

// 缓存键：enterpriseId:knowledgeBaseId
const cacheKey = `${enterpriseId}:${kbId}`;
let vectors = vectorCache.get(cacheKey);

if (!vectors) {
  // 从 Postgres 加载
  const chunks = await prisma.textChunk.findMany({
    where: { knowledgeBaseId: kbId },
    select: { id: true, embedding: true }
  });
  
  vectors = chunks.map(c => new Float32Array(c.embedding.buffer));
  vectorCache.set(cacheKey, vectors);
}
```

**Cosine 相似度计算**：
```typescript
// 使用 WASM 加速（@xenova/transformers 内置）
import { cos_sim } from '@xenova/transformers';

function cosineSimilarity(a: Float32Array, b: Float32Array): number {
  return cos_sim(a, b);
}

// 批量计算（GPU 加速，未来可选）
function batchCosine(query: Float32Array, corpus: Float32Array[]): number[] {
  return corpus.map(vec => cos_sim(query, vec));
}
```

**性能指标**：
- 冷启动（从 Postgres 加载）: 100-200ms
- 热缓存检索 (20k chunks): 30-50ms
- 内存占用: 120MB/企业 × 5 = 600MB

### 3. Lexical 检索 (BM25)

**分词**：Node.js Intl.Segmenter

```typescript
const segmenter = new Intl.Segmenter('zh-CN', { granularity: 'word' });

function tokenize(text: string): string[] {
  const segments = segmenter.segment(text);
  return Array.from(segments)
    .filter(s => s.isWordLike)
    .map(s => s.segment.toLowerCase());
}
```

**候选召回**：pg_trgm

```sql
-- 创建扩展（首次运行）
CREATE EXTENSION IF NOT EXISTS pg_trgm;

-- 创建 GIN 索引
CREATE INDEX idx_text_chunks_content_trgm 
ON text_chunks USING GIN (content gin_trgm_ops);

-- 查询（先用 pg_trgm 缩小范围）
SELECT id, content, similarity(content, $1) AS sim
FROM text_chunks
WHERE knowledgeBase.enterpriseId = $2
  AND knowledgeBaseId = ANY($3)
  AND content % $1              -- pg_trgm 相似度算子
ORDER BY sim DESC
LIMIT 100;  -- 取前 100 作为 BM25 候选
```

**BM25 打分**：
```typescript
interface BM25Params {
  k1: number;  // 术语频率饱和参数，默认 1.5
  b: number;   // 长度归一化参数，默认 0.75
}

class BM25Scorer {
  private avgDocLen: number;
  private docCount: number;
  private idf: Map<string, number>;
  
  constructor(corpus: { id: string; tokens: string[] }[], params: BM25Params = { k1: 1.5, b: 0.75 }) {
    this.docCount = corpus.length;
    this.avgDocLen = corpus.reduce((sum, doc) => sum + doc.tokens.length, 0) / this.docCount;
    
    // 计算 IDF
    this.idf = new Map();
    const docFreq = new Map<string, number>();
    
    for (const doc of corpus) {
      const uniqueTokens = new Set(doc.tokens);
      for (const token of uniqueTokens) {
        docFreq.set(token, (docFreq.get(token) || 0) + 1);
      }
    }
    
    for (const [token, df] of docFreq) {
      this.idf.set(token, Math.log((this.docCount - df + 0.5) / (df + 0.5) + 1));
    }
  }
  
  score(queryTokens: string[], docTokens: string[], docId: string): number {
    const docLen = docTokens.length;
    const termFreq = new Map<string, number>();
    
    for (const token of docTokens) {
      termFreq.set(token, (termFreq.get(token) || 0) + 1);
    }
    
    let score = 0;
    for (const qToken of queryTokens) {
      const tf = termFreq.get(qToken) || 0;
      const idf = this.idf.get(qToken) || 0;
      
      score += idf * (tf * (this.params.k1 + 1)) / 
               (tf + this.params.k1 * (1 - this.params.b + this.params.b * docLen / this.avgDocLen));
    }
    
    return score;
  }
}
```

**性能指标**：
- pg_trgm 候选召回: 20-30ms
- BM25 打分 (100 候选): 5-10ms
- 总计: 25-40ms

---

### 4. Hybrid Fusion (RRF)

**Reciprocal Rank Fusion 算法**：

```typescript
interface RankedResult {
  chunkId: string;
  score: number;
  rank: number;
}

function reciprocalRankFusion(
  lexicalResults: RankedResult[],
  vectorResults: RankedResult[],
  k: number = 60  // 常数，调节融合权重
): RankedResult[] {
  const rrfScores = new Map<string, number>();
  
  // Lexical 贡献
  for (let i = 0; i < lexicalResults.length; i++) {
    const chunkId = lexicalResults[i].chunkId;
    const rrfScore = 1 / (k + i + 1);
    rrfScores.set(chunkId, (rrfScores.get(chunkId) || 0) + rrfScore);
  }
  
  // Vector 贡献
  for (let i = 0; i < vectorResults.length; i++) {
    const chunkId = vectorResults[i].chunkId;
    const rrfScore = 1 / (k + i + 1);
    rrfScores.set(chunkId, (rrfScores.get(chunkId) || 0) + rrfScore);
  }
  
  // 按 RRF 分数排序
  return Array.from(rrfScores.entries())
    .map(([chunkId, score]) => ({ chunkId, score, rank: 0 }))
    .sort((a, b) => b.score - a.score)
    .slice(0, 20)  // 取 top 20
    .map((item, idx) => ({ ...item, rank: idx + 1 }));
}
```

**性能指标**：
- RRF 融合计算: 5-10ms
- 总检索时间: 60-110ms (Lexical) + 80-150ms (Vector) = 140-260ms ✅

---

### 5. 文档处理队列

**方案**：BullMQ + Redis

```typescript
import { Queue, Worker } from 'bullmq';

// 队列定义
const documentQueue = new Queue('document-processing', {
  connection: {
    host: process.env.REDIS_HOST,
    port: parseInt(process.env.REDIS_PORT)
  }
});

// 添加任务
async function enqueueDocument(documentId: string, knowledgeBaseId: string) {
  await documentQueue.add('process-document', {
    documentId,
    knowledgeBaseId
  }, {
    attempts: 3,
    backoff: { type: 'exponential', delay: 2000 }
  });
}

// Worker 处理
const worker = new Worker('document-processing', async (job) => {
  const { documentId, knowledgeBaseId } = job.data;
  
  // 1. 更新状态为 PROCESSING
  await prisma.document.update({
    where: { id: documentId },
    data: { status: 'PROCESSING' }
  });
  
  try {
    // 2. 解析文档
    const content = await parseDocument(documentId);
    
    // 3. 分块
    const chunks = chunkText(content, { maxTokens: 512, overlap: 50 });
    
    // 4. 批量 embedding
    const embeddings = await embeddingService.embedBatch(chunks);
    
    // 5. 存储
    await prisma.textChunk.createMany({
      data: chunks.map((chunk, i) => ({
        knowledgeBaseId,
        documentId,
        content: chunk,
        embedding: Buffer.from(embeddings[i].buffer),
        embeddingModel: 'bge-small-zh-v1.5'
      }))
    });
    
    // 6. 更新状态为 READY
    await prisma.document.update({
      where: { id: documentId },
      data: { status: 'READY', processedAt: new Date() }
    });
    
    // 7. 使向量缓存失效
    vectorCache.delete(`${enterpriseId}:${knowledgeBaseId}`);
    
  } catch (error) {
    // 失败标记
    await prisma.document.update({
      where: { id: documentId },
      data: { 
        status: 'FAILED',
        lastError: error.message
      }
    });
    throw error;
  }
}, {
  connection: {
    host: process.env.REDIS_HOST,
    port: parseInt(process.env.REDIS_PORT)
  },
  concurrency: 2  // 2 核 CPU，并发 2 个任务
});
```

**状态轮询 API**：

```typescript
// GET /knowledge-bases/:id/documents/status
async getDocumentStatus(knowledgeBaseId: string) {
  const docs = await prisma.document.findMany({
    where: { knowledgeBaseId },
    select: {
      id: true,
      originalName: true,
      status: true,
      lastError: true,
      processedAt: true
    }
  });
  
  const summary = {
    total: docs.length,
    pending: docs.filter(d => d.status === 'PENDING').length,
    processing: docs.filter(d => d.status === 'PROCESSING').length,
    ready: docs.filter(d => d.status === 'READY').length,
    failed: docs.filter(d => d.status === 'FAILED').length,
    documents: docs
  };
  
  return summary;
}
```

**前端轮询**：

```typescript
// 每 3 秒轮询一次状态
const { data: status } = useQuery({
  queryKey: ['document-status', kbId],
  queryFn: () => api.get(`/knowledge-bases/${kbId}/documents/status`),
  refetchInterval: 3000,
  enabled: hasProcessingDocs  // 有处理中的文档才轮询
});
```

---

## 数据库 Schema 变更

### 新增字段

```prisma
model TextChunk {
  id              String   @id @default(cuid())
  knowledgeBaseId String
  knowledgeBase   KnowledgeBase @relation(fields: [knowledgeBaseId], references: [id], onDelete: Cascade)
  
  documentId      String?
  document        Document? @relation(fields: [documentId], references: [id], onDelete: SetNull)
  
  content         String   @db.Text
  title           String?
  source          String   // "doc:{documentId}" 或 "manual"
  
  // 新增：向量检索
  embedding       Bytes?   // Float32Array 序列化
  embeddingModel  String?  // "bge-small-zh-v1.5"
  
  // 新增：Lexical 检索优化
  tokens          Json?    // string[] 预分词结果，加速 BM25
  
  createdAt       DateTime @default(now())
  updatedAt       DateTime @updatedAt
  creatorId       String?
  creator         User?    @relation(fields: [creatorId], references: [id], onDelete: SetNull)
  
  @@index([knowledgeBaseId, createdAt])
  @@index([documentId])
  @@map("text_chunks")
}

model Document {
  id              String   @id @default(cuid())
  knowledgeBaseId String
  knowledgeBase   KnowledgeBase @relation(fields: [knowledgeBaseId], references: [id], onDelete: Cascade)
  
  filename        String
  originalName    String
  mimeType        String
  fileSize        Int
  storagePath     String
  
  // 处理状态
  status          DocumentStatus @default(PENDING)
  lastError       String?  @db.Text
  processedAt     DateTime?
  
  // 新增：embedding 配置（企业级覆盖）
  embeddingModel  String?  // 企业自定义模型
  version         Int      @default(1)  // 处理版本号，升级算法后可重处理
  
  createdAt       DateTime @default(now())
  updatedAt       DateTime @updatedAt
  uploaderId      String
  uploader        User     @relation(fields: [uploaderId], references: [id])
  
  chunks          TextChunk[]
  
  @@index([knowledgeBaseId, status])
  @@map("documents")
}

enum DocumentStatus {
  PENDING      // 已上传，等待处理
  PROCESSING   // 处理中
  READY        // 已完成
  FAILED       // 处理失败
}
```

### 索引优化

```sql
-- 企业隔离 + 知识库过滤
CREATE INDEX idx_text_chunks_kb_enterprise 
ON text_chunks (knowledge_base_id) 
INCLUDE (embedding, content);

-- pg_trgm 全文索引
CREATE EXTENSION IF NOT EXISTS pg_trgm;
CREATE INDEX idx_text_chunks_content_trgm 
ON text_chunks USING GIN (content gin_trgm_ops);

-- 文档处理状态查询
CREATE INDEX idx_documents_kb_status 
ON documents (knowledge_base_id, status, updated_at);
```

---

## API 设计

### 检索 API

```typescript
// POST /knowledge-bases/search
interface SearchRequest {
  query: string;
  instanceId: string;          // 员工实例 ID（用于权限）
  topK?: number;               // 返回结果数，默认 5
  scoreThreshold?: number;     // 最低分数，默认 0.7
  strategy?: 'hybrid' | 'vector' | 'lexical';  // 检索策略
}

interface SearchResponse {
  query: string;
  strategy: string;            // 实际使用的策略
  durationMs: number;
  results: SearchResult[];
}

interface SearchResult {
  chunkId: string;
  content: string;
  source: string;              // "doc:xxx" 或 "manual"
  score: number;
  knowledgeBaseId: string;
  knowledgeBaseName: string;
}
```

### 测试检索 API

```typescript
// POST /knowledge-bases/:id/test-search
// 仅管理员可用，不检查授权，用于测试知识库质量
interface TestSearchRequest {
  query: string;
  topK?: number;
  scoreThreshold?: number;
  strategy?: 'hybrid' | 'vector' | 'lexical';
  useRerank?: boolean;         // 是否使用重排序（未来）
}

interface TestSearchResponse extends SearchResponse {
  hitCount: number;
  lexicalResults?: SearchResult[];   // 调试用
  vectorResults?: SearchResult[];    // 调试用
}
```

---

## 实施计划

### Phase 1: 基础设施（2-3 天）

**1.1 Docker 容器部署**
- [ ] `docker-compose.yml` 新增 `embedding` 服务（TEI）
- [ ] `docker-compose.yml` 确保 Redis 服务（BullMQ 依赖）
- [ ] 环境变量配置：`EMBEDDING_*`, `REDIS_*`
- [ ] 启动脚本验证：`pnpm docker:up`

**1.2 数据库迁移**
```bash
# 创建迁移
cd backend
npx prisma migrate dev --name add-embedding-and-tokens

# 迁移内容：
# - TextChunk 新增 embedding(Bytes), embeddingModel(String), tokens(Json)
# - Document 新增 status(Enum), lastError(Text), processedAt(DateTime), embeddingModel(String), version(Int)
# - 创建 DocumentStatus enum
# - 创建索引：idx_text_chunks_kb_enterprise, idx_text_chunks_content_trgm, idx_documents_kb_status
```

**1.3 依赖安装**
```bash
# backend/package.json 新增
pnpm add bullmq ioredis lru-cache @xenova/transformers
pnpm add -D @types/ioredis

# 验证 Node.js 版本支持 Intl.Segmenter
node -e "console.log(new Intl.Segmenter('zh-CN').segment('测试文本'))"
```

---

### Phase 2: Embedding 服务（1-2 天）

**2.1 EmbeddingService 重构**

```typescript
// backend/src/modules/knowledge/embedding.service.ts
@Injectable()
export class EmbeddingService implements OnModuleInit {
  private provider: 'tei' | 'wasm' | null = null;
  private teiClient?: Axios;
  private wasmPipeline?: any;
  
  async onModuleInit() {
    const provider = this.config.get('EMBEDDING_PROVIDER', 'tei');
    
    if (provider === 'tei') {
      const baseURL = this.config.get('EMBEDDING_BASE_URL');
      if (await this.testTEI(baseURL)) {
        this.teiClient = axios.create({ baseURL });
        this.provider = 'tei';
        this.logger.log('TEI embedding initialized');
        return;
      }
      this.logger.warn('TEI unavailable, fallback to WASM');
    }
    
    // 降级到 WASM
    const { pipeline } = await import('@xenova/transformers');
    this.wasmPipeline = await pipeline(
      'feature-extraction', 
      'Xenova/bge-small-zh-v1.5'
    );
    this.provider = 'wasm';
    this.logger.log('WASM embedding initialized');
  }
  
  async embedText(text: string): Promise<Float32Array> {
    if (this.provider === 'tei') {
      const { data } = await this.teiClient.post('/embed', { inputs: text });
      return new Float32Array(data[0]);
    } else {
      const output = await this.wasmPipeline(text, { 
        pooling: 'mean', 
        normalize: true 
      });
      return output.data;
    }
  }
  
  async embedBatch(texts: string[], batchSize = 32): Promise<Float32Array[]> {
    const results: Float32Array[] = [];
    
    for (let i = 0; i < texts.length; i += batchSize) {
      const batch = texts.slice(i, i + batchSize);
      
      if (this.provider === 'tei') {
        const { data } = await this.teiClient.post('/embed', { inputs: batch });
        results.push(...data.map((d: number[]) => new Float32Array(d)));
      } else {
        for (const text of batch) {
          const embedding = await this.embedText(text);
          results.push(embedding);
        }
      }
      
      this.logger.log(`Embedded batch ${Math.floor(i / batchSize) + 1}`);
    }
    
    return results;
  }
}
```

**2.2 测试**
```bash
# 启动 TEI 容器
docker-compose up -d embedding

# 测试 API
curl -X POST http://localhost:8080/embed \
  -H "Content-Type: application/json" \
  -d '{"inputs": "这是一个测试"}'
```

---

### Phase 3: 向量检索（2 天）

**3.1 VectorService 重构**

```typescript
// backend/src/modules/knowledge/vector.service.ts
import LRU from 'lru-cache';
import { cos_sim } from '@xenova/transformers';

interface CachedVectors {
  chunkIds: string[];
  vectors: Float32Array[];
}

@Injectable()
export class VectorService {
  private cache: LRU<string, CachedVectors>;
  
  constructor(private prisma: PrismaService) {
    this.cache = new LRU({
      max: 5,
      maxSize: 600 * 1024 * 1024,
      sizeCalculation: (item) => {
        return item.vectors.reduce((sum, v) => sum + v.length * 4, 0);
      }
    });
  }
  
  async search(
    queryVector: Float32Array,
    enterpriseId: string,
    knowledgeBaseIds: string[],
    topK: number = 20
  ): Promise<Array<{ chunkId: string; score: number }>> {
    const allResults: Array<{ chunkId: string; score: number }> = [];
    
    for (const kbId of knowledgeBaseIds) {
      const cacheKey = `${enterpriseId}:${kbId}`;
      let cached = this.cache.get(cacheKey);
      
      if (!cached) {
        // 从 Postgres 加载
        const chunks = await this.prisma.textChunk.findMany({
          where: { 
            knowledgeBase: { 
              enterpriseId,
              id: kbId 
            }
          },
          select: { id: true, embedding: true }
        });
        
        cached = {
          chunkIds: chunks.map(c => c.id),
          vectors: chunks.map(c => new Float32Array(c.embedding))
        };
        
        this.cache.set(cacheKey, cached);
        this.logger.log(`Loaded ${chunks.length} vectors for ${kbId} into cache`);
      }
      
      // 批量 cosine 相似度
      const scores = cached.vectors.map(vec => cos_sim(queryVector, vec));
      
      for (let i = 0; i < cached.chunkIds.length; i++) {
        allResults.push({
          chunkId: cached.chunkIds[i],
          score: scores[i]
        });
      }
    }
    
    // 按分数排序，取 topK
    return allResults
      .sort((a, b) => b.score - a.score)
      .slice(0, topK);
  }
  
  invalidateCache(enterpriseId: string, knowledgeBaseId: string) {
    this.cache.delete(`${enterpriseId}:${knowledgeBaseId}`);
  }
}
```

---

### Phase 4: Lexical 检索（2 天）

**4.1 分词器**

```typescript
// backend/src/modules/knowledge/text-tokenizer.ts
export class TextTokenizer {
  private segmenter = new Intl.Segmenter('zh-CN', { granularity: 'word' });
  private stopWords = new Set(['的', '了', '在', '是', '我', '有', '和', '就', '不', '人', '都', '一', '一个', '上', '也', '很', '到', '说', '要', '去', '你', '会', '着', '没有', '看', '好', '自己', '这']);
  
  tokenize(text: string): string[] {
    const segments = Array.from(this.segmenter.segment(text));
    
    return segments
      .filter(s => s.isWordLike)
      .map(s => s.segment.toLowerCase())
      .filter(token => {
        // 过滤停用词和单字符
        if (this.stopWords.has(token) || token.length < 2) return false;
        // 保留中文、英文、数字
        return /[一-龥a-z0-9]/.test(token);
      });
  }
}
```

**4.2 BM25 评分器**

```typescript
// backend/src/modules/knowledge/bm25.scorer.ts
export class BM25Scorer {
  private avgDocLen: number;
  private docCount: number;
  private idf = new Map<string, number>();
  
  constructor(
    private corpus: Array<{ id: string; tokens: string[] }>,
    private params = { k1: 1.5, b: 0.75 }
  ) {
    this.docCount = corpus.length;
    this.avgDocLen = corpus.reduce((sum, doc) => sum + doc.tokens.length, 0) / this.docCount;
    this.computeIDF();
  }
  
  private computeIDF() {
    const docFreq = new Map<string, number>();
    
    for (const doc of this.corpus) {
      const uniqueTokens = new Set(doc.tokens);
      for (const token of uniqueTokens) {
        docFreq.set(token, (docFreq.get(token) || 0) + 1);
      }
    }
    
    for (const [token, df] of docFreq) {
      this.idf.set(token, Math.log((this.docCount - df + 0.5) / (df + 0.5) + 1));
    }
  }
  
  score(queryTokens: string[], docTokens: string[]): number {
    const docLen = docTokens.length;
    const termFreq = new Map<string, number>();
    
    for (const token of docTokens) {
      termFreq.set(token, (termFreq.get(token) || 0) + 1);
    }
    
    let score = 0;
    for (const qToken of queryTokens) {
      const tf = termFreq.get(qToken) || 0;
      const idf = this.idf.get(qToken) || 0;
      
      const numerator = tf * (this.params.k1 + 1);
      const denominator = tf + this.params.k1 * (1 - this.params.b + this.params.b * docLen / this.avgDocLen);
      
      score += idf * numerator / denominator;
    }
    
    return score;
  }
  
  scoreAll(queryTokens: string[]): Array<{ id: string; score: number }> {
    return this.corpus.map(doc => ({
      id: doc.id,
      score: this.score(queryTokens, doc.tokens)
    })).sort((a, b) => b.score - a.score);
  }
}
```

**4.3 Lexical 检索服务**

```typescript
// backend/src/modules/knowledge/lexical-search.service.ts
@Injectable()
export class LexicalSearchService {
  constructor(
    private prisma: PrismaService,
    private tokenizer: TextTokenizer
  ) {}
  
  async search(
    query: string,
    enterpriseId: string,
    knowledgeBaseIds: string[],
    topK: number = 20
  ): Promise<Array<{ chunkId: string; score: number }>> {
    const queryTokens = this.tokenizer.tokenize(query);
    const queryPattern = queryTokens.join(' | ');
    
    // Step 1: pg_trgm 候选召回（前 100）
    const candidates = await this.prisma.$queryRaw<Array<{ id: string; content: string; tokens: string[] }>>`
      SELECT id, content, tokens
      FROM text_chunks tc
      JOIN knowledge_bases kb ON tc.knowledge_base_id = kb.id
      WHERE kb.enterprise_id = ${enterpriseId}
        AND tc.knowledge_base_id = ANY(${knowledgeBaseIds})
        AND tc.content % ${query}
      ORDER BY similarity(tc.content, ${query}) DESC
      LIMIT 100
    `;
    
    if (candidates.length === 0) {
      return [];
    }
    
    // Step 2: BM25 打分
    const corpus = candidates.map(c => ({
      id: c.id,
      tokens: c.tokens || this.tokenizer.tokenize(c.content)
    }));
    
    const scorer = new BM25Scorer(corpus);
    const results = scorer.scoreAll(queryTokens);
    
    return results.slice(0, topK);
  }
}
```

---

### Phase 5: Hybrid Fusion（1 天）

```typescript
// backend/src/modules/knowledge/knowledge-search.service.ts
@Injectable()
export class KnowledgeSearchService {
  constructor(
    private prisma: PrismaService,
    private embedding: EmbeddingService,
    private vector: VectorService,
    private lexical: LexicalSearchService
  ) {}
  
  async search(
    query: string,
    instanceId: string,
    options: {
      topK?: number;
      scoreThreshold?: number;
      strategy?: 'hybrid' | 'vector' | 'lexical';
    } = {}
  ): Promise<SearchResponse> {
    const startTime = Date.now();
    const { topK = 5, scoreThreshold = 0.7, strategy = 'hybrid' } = options;
    
    // 安全边界：获取 enterpriseId 和授权知识库
    const { enterpriseId, kbIds } = await this.getAuthorizedKnowledgeBases(instanceId);
    
    if (kbIds.length === 0) {
      return { query, strategy: 'none', durationMs: 0, results: [] };
    }
    
    let finalResults: Array<{ chunkId: string; score: number }> = [];
    
    if (strategy === 'lexical') {
      // 仅 Lexical
      finalResults = await this.lexical.search(query, enterpriseId, kbIds, topK * 2);
      
    } else if (strategy === 'vector') {
      // 仅 Vector
      const queryVector = await this.embedding.embedText(query);
      finalResults = await this.vector.search(queryVector, enterpriseId, kbIds, topK * 2);
      
    } else {
      // Hybrid (RRF)
      const [lexicalResults, vectorResults] = await Promise.all([
        this.lexical.search(query, enterpriseId, kbIds, topK * 2),
        (async () => {
          const queryVector = await this.embedding.embedText(query);
          return this.vector.search(queryVector, enterpriseId, kbIds, topK * 2);
        })()
      ]);
      
      finalResults = this.reciprocalRankFusion(lexicalResults, vectorResults);
    }
    
    // 过滤低分 + 获取完整内容
    const filteredResults = finalResults
      .filter(r => r.score >= scoreThreshold)
      .slice(0, topK);
    
    const chunks = await this.prisma.textChunk.findMany({
      where: { id: { in: filteredResults.map(r => r.chunkId) } },
      include: { knowledgeBase: { select: { id: true, name: true } } }
    });
    
    const chunkMap = new Map(chunks.map(c => [c.id, c]));
    
    const results: SearchResult[] = filteredResults
      .map(r => {
        const chunk = chunkMap.get(r.chunkId);
        if (!chunk) return null;
        
        return {
          chunkId: r.chunkId,
          content: chunk.content,
          source: chunk.source,
          score: r.score,
          knowledgeBaseId: chunk.knowledgeBase.id,
          knowledgeBaseName: chunk.knowledgeBase.name
        };
      })
      .filter(Boolean);
    
    return {
      query,
      strategy,
      durationMs: Date.now() - startTime,
      results
    };
  }
  
  private reciprocalRankFusion(
    lexicalResults: Array<{ chunkId: string; score: number }>,
    vectorResults: Array<{ chunkId: string; score: number }>,
    k = 60
  ): Array<{ chunkId: string; score: number }> {
    const rrfScores = new Map<string, number>();
    
    lexicalResults.forEach((r, i) => {
      const rrfScore = 1 / (k + i + 1);
      rrfScores.set(r.chunkId, (rrfScores.get(r.chunkId) || 0) + rrfScore);
    });
    
    vectorResults.forEach((r, i) => {
      const rrfScore = 1 / (k + i + 1);
      rrfScores.set(r.chunkId, (rrfScores.get(r.chunkId) || 0) + rrfScore);
    });
    
    return Array.from(rrfScores.entries())
      .map(([chunkId, score]) => ({ chunkId, score }))
      .sort((a, b) => b.score - a.score);
  }
  
  private async getAuthorizedKnowledgeBases(instanceId: string): Promise<{ enterpriseId: string; kbIds: string[] }> {
    const instance = await this.prisma.digitalEmployeeInstance.findUnique({
      where: { id: instanceId },
      include: { 
        template: { select: { enterpriseId: true } },
        grants: { select: { knowledgeBaseId: true } }
      }
    });
    
    if (!instance) {
      throw new NotFoundException('Instance not found');
    }
    
    const enterpriseId = instance.template.enterpriseId;
    const kbIds = instance.grants.map(g => g.knowledgeBaseId);
    
    return { enterpriseId, kbIds };
  }
}
```

---

### Phase 6: 文档处理队列（1-2 天）

**6.1 队列配置**

```typescript
// backend/src/modules/knowledge/queue/document-queue.ts
import { Queue, Worker, Job } from 'bullmq';
import { Injectable, OnModuleInit, OnModuleDestroy } from '@nestjs/common';

interface DocumentJobData {
  documentId: string;
  knowledgeBaseId: string;
  enterpriseId: string;
}

@Injectable()
export class DocumentQueue implements OnModuleInit, OnModuleDestroy {
  private queue: Queue<DocumentJobData>;
  private worker: Worker<DocumentJobData>;
  
  constructor(
    private config: ConfigService,
    private processor: DocumentProcessorService,
    private prisma: PrismaService
  ) {}
  
  async onModuleInit() {
    const connection = {
      host: this.config.get('REDIS_HOST', 'localhost'),
      port: this.config.get('REDIS_PORT', 6379)
    };
    
    this.queue = new Queue('document-processing', { connection });
    
    this.worker = new Worker('document-processing', 
      async (job: Job<DocumentJobData>) => {
        return this.processor.processDocument(job.data);
      }, 
      {
        connection,
        concurrency: 2,  // 2 核 CPU
        limiter: {
          max: 10,       // 每分钟最多 10 个任务
          duration: 60000
        }
      }
    );
    
    this.worker.on('completed', (job) => {
      this.logger.log(`Document ${job.data.documentId} processed successfully`);
    });
    
    this.worker.on('failed', (job, err) => {
      this.logger.error(`Document ${job.data.documentId} failed: ${err.message}`);
    });
  }
  
  async enqueue(data: DocumentJobData) {
    return this.queue.add('process', data, {
      attempts: 3,
      backoff: {
        type: 'exponential',
        delay: 2000
      },
      removeOnComplete: 100,  // 保留最近 100 个成功任务
      removeOnFail: 500       // 保留最近 500 个失败任务
    });
  }
  
  async onModuleDestroy() {
    await this.worker.close();
    await this.queue.close();
  }
}
```

**6.2 文档处理器**

```typescript
// backend/src/modules/knowledge/document-processor.service.ts
@Injectable()
export class DocumentProcessorService {
  constructor(
    private prisma: PrismaService,
    private parser: DocumentParserService,
    private chunker: TextChunkerService,
    private embedding: EmbeddingService,
    private tokenizer: TextTokenizer,
    private vector: VectorService
  ) {}
  
  async processDocument(data: DocumentJobData): Promise<void> {
    const { documentId, knowledgeBaseId, enterpriseId } = data;
    
    // 1. 更新状态
    await this.prisma.document.update({
      where: { id: documentId },
      data: { status: 'PROCESSING' }
    });
    
    try {
      // 2. 解析文档内容
      const document = await this.prisma.document.findUnique({
        where: { id: documentId }
      });
      
      const content = await this.parser.parse(document.storagePath, document.mimeType);
      
      // 3. 分块
      const chunks = this.chunker.chunk(content, {
        maxTokens: 512,
        overlap: 50,
        preserveSentences: true
      });
      
      // 4. 批量 embedding
      const embeddings = await this.embedding.embedBatch(
        chunks.map(c => c.content)
      );
      
      // 5. 预分词（用于 BM25）
      const tokensList = chunks.map(c => 
        this.tokenizer.tokenize(c.content)
      );
      
      // 6. 批量插入
      await this.prisma.textChunk.createMany({
        data: chunks.map((chunk, i) => ({
          knowledgeBaseId,
          documentId,
          content: chunk.content,
          title: chunk.title,
          source: `doc:${documentId}`,
          embedding: Buffer.from(embeddings[i].buffer),
          embeddingModel: 'bge-small-zh-v1.5',
          tokens: tokensList[i]
        }))
      });
      
      // 7. 更新文档状态
      await this.prisma.document.update({
        where: { id: documentId },
        data: {
          status: 'READY',
          processedAt: new Date()
        }
      });
      
      // 8. 使向量缓存失效
      this.vector.invalidateCache(enterpriseId, knowledgeBaseId);
      
      this.logger.log(`Document ${documentId} processed: ${chunks.length} chunks created`);
      
    } catch (error) {
      // 标记失败
      await this.prisma.document.update({
        where: { id: documentId },
        data: {
          status: 'FAILED',
          lastError: error.message
        }
      });
      
      throw error;
    }
  }
}
```

**6.3 文本分块器**

```typescript
// backend/src/modules/knowledge/text-chunker.service.ts
interface ChunkOptions {
  maxTokens: number;     // 最大 token 数
  overlap: number;       // 重叠 token 数
  preserveSentences: boolean;  // 保持句子完整
}

interface Chunk {
  content: string;
  title?: string;
  startOffset: number;
  endOffset: number;
}

@Injectable()
export class TextChunkerService {
  private sentenceSegmenter = new Intl.Segmenter('zh-CN', { granularity: 'sentence' });
  
  chunk(text: string, options: ChunkOptions): Chunk[] {
    const { maxTokens, overlap, preserveSentences } = options;
    
    if (!preserveSentences) {
      return this.chunkByTokens(text, maxTokens, overlap);
    }
    
    // 按句子分块
    const sentences = Array.from(this.sentenceSegmenter.segment(text))
      .map(s => s.segment.trim())
      .filter(s => s.length > 0);
    
    const chunks: Chunk[] = [];
    let currentChunk: string[] = [];
    let currentTokens = 0;
    let startOffset = 0;
    
    for (const sentence of sentences) {
      const sentenceTokens = this.estimateTokens(sentence);
      
      if (currentTokens + sentenceTokens > maxTokens && currentChunk.length > 0) {
        // 保存当前块
        const content = currentChunk.join(' ');
        chunks.push({
          content,
          startOffset,
          endOffset: startOffset + content.length
        });
        
        // 重叠处理：保留最后几个句子
        const overlapSentences = this.getOverlapSentences(currentChunk, overlap);
        currentChunk = overlapSentences;
        currentTokens = overlapSentences.reduce((sum, s) => sum + this.estimateTokens(s), 0);
        startOffset = startOffset + content.length - overlapSentences.join(' ').length;
      }
      
      currentChunk.push(sentence);
      currentTokens += sentenceTokens;
    }
    
    // 保存最后一块
    if (currentChunk.length > 0) {
      const content = currentChunk.join(' ');
      chunks.push({
        content,
        startOffset,
        endOffset: startOffset + content.length
      });
    }
    
    return chunks;
  }
  
  private estimateTokens(text: string): number {
    // 中文：~1.5 字符 = 1 token
    // 英文：~4 字符 = 1 token
    const chineseChars = (text.match(/[一-龥]/g) || []).length;
    const otherChars = text.length - chineseChars;
    return Math.ceil(chineseChars / 1.5 + otherChars / 4);
  }
  
  private getOverlapSentences(sentences: string[], overlapTokens: number): string[] {
    const result: string[] = [];
    let tokens = 0;
    
    for (let i = sentences.length - 1; i >= 0; i--) {
      const sentenceTokens = this.estimateTokens(sentences[i]);
      if (tokens + sentenceTokens > overlapTokens) break;
      result.unshift(sentences[i]);
      tokens += sentenceTokens;
    }
    
    return result;
  }
  
  private chunkByTokens(text: string, maxTokens: number, overlap: number): Chunk[] {
    // 简单按字符分块（用于不保持句子完整的场景）
    const chunkSize = maxTokens * 2;  // 粗略估计
    const overlapSize = overlap * 2;
    const chunks: Chunk[] = [];
    
    for (let i = 0; i < text.length; i += chunkSize - overlapSize) {
      const end = Math.min(i + chunkSize, text.length);
      chunks.push({
        content: text.slice(i, end),
        startOffset: i,
        endOffset: end
      });
    }
    
    return chunks;
  }
}
```

---

### Phase 7: 测试与优化（2-3 天）

**7.1 单元测试**

```typescript
// backend/src/modules/knowledge/__tests__/bm25.scorer.spec.ts
describe('BM25Scorer', () => {
  it('should rank documents by relevance', () => {
    const corpus = [
      { id: '1', tokens: ['机器', '学习', '算法'] },
      { id: '2', tokens: ['深度', '学习', '神经网络'] },
      { id: '3', tokens: ['机器', '视觉', '图像'] }
    ];
    
    const scorer = new BM25Scorer(corpus);
    const results = scorer.scoreAll(['机器', '学习']);
    
    expect(results[0].id).toBe('1');  // 包含两个词
    expect(results[1].id).toBe('2');  // 包含一个词
    expect(results[2].id).toBe('3');  // 包含一个词
  });
});

// backend/src/modules/knowledge/__tests__/rrf.spec.ts
describe('Reciprocal Rank Fusion', () => {
  it('should merge lexical and vector results', () => {
    const lexicalResults = [
      { chunkId: 'a', score: 0.9 },
      { chunkId: 'b', score: 0.8 }
    ];
    
    const vectorResults = [
      { chunkId: 'b', score: 0.95 },
      { chunkId: 'c', score: 0.85 }
    ];
    
    const service = new KnowledgeSearchService(/* ... */);
    const merged = service['reciprocalRankFusion'](lexicalResults, vectorResults);
    
    expect(merged[0].chunkId).toBe('b');  // 两个排名都高
  });
});
```

**7.2 性能测试**

```typescript
// backend/src/modules/knowledge/__tests__/search.perf.spec.ts
describe('Search Performance', () => {
  it('should complete search within 500ms', async () => {
    const service = new KnowledgeSearchService(/* ... */);
    
    const start = Date.now();
    const result = await service.search('测试查询', 'instance-id', {
      topK: 5,
      strategy: 'hybrid'
    });
    const duration = Date.now() - start;
    
    expect(duration).toBeLessThan(500);
    expect(result.results.length).toBeGreaterThan(0);
  });
  
  it('should handle 20k chunks efficiently', async () => {
    // 模拟 20k chunks
    const chunks = Array.from({ length: 20000 }, (_, i) => ({
      id: `chunk-${i}`,
      content: `测试内容 ${i}`,
      embedding: new Float32Array(1024).fill(Math.random())
    }));
    
    // 测试向量检索
    const vectorService = new VectorService(/* ... */);
    const queryVector = new Float32Array(1024).fill(Math.random());
    
    const start = Date.now();
    const results = await vectorService.search(queryVector, 'ent-id', ['kb-id'], 20);
    const duration = Date.now() - start;
    
    expect(duration).toBeLessThan(100);  // < 100ms
  });
});
```

**7.3 集成测试**

```bash
# 创建测试脚本
cat > backend/test-knowledge-search.ts << 'EOF'
import { PrismaClient } from '@prisma/client';
import axios from 'axios';

const prisma = new PrismaClient();

async function testSearch() {
  // 1. 创建测试企业和知识库
  const enterprise = await prisma.enterprise.create({
    data: { name: 'Test Enterprise' }
  });
  
  const kb = await prisma.knowledgeBase.create({
    data: {
      name: 'Test KB',
      enterpriseId: enterprise.id
    }
  });
  
  // 2. 插入测试文档
  const chunks = [
    '人工智能是计算机科学的一个分支，致力于创建智能机器。',
    '机器学习是人工智能的一个子领域，专注于算法和统计模型。',
    '深度学习是机器学习的一种方法，使用神经网络进行学习。'
  ];
  
  for (const content of chunks) {
    // 获取 embedding
    const { data } = await axios.post('http://localhost:8080/embed', {
      inputs: content
    });
    
    await prisma.textChunk.create({
      data: {
        knowledgeBaseId: kb.id,
        content,
        source: 'test',
        embedding: Buffer.from(new Float32Array(data[0]).buffer),
        embeddingModel: 'bge-small-zh-v1.5'
      }
    });
  }
  
  // 3. 测试检索
  const response = await axios.post('http://localhost:3001/knowledge-bases/search', {
    query: '什么是深度学习',
    instanceId: 'test-instance',
    topK: 3,
    strategy: 'hybrid'
  });
  
  console.log('Search Results:', JSON.stringify(response.data, null, 2));
  console.log('Duration:', response.data.durationMs, 'ms');
  
  // 清理
  await prisma.textChunk.deleteMany({ where: { knowledgeBaseId: kb.id } });
  await prisma.knowledgeBase.delete({ where: { id: kb.id } });
  await prisma.enterprise.delete({ where: { id: enterprise.id } });
}

testSearch().catch(console.error).finally(() => prisma.$disconnect());
EOF

# 运行测试
pnpm tsx backend/test-knowledge-search.ts
```

---

## 性能指标与验证

### 目标 vs 实测

| 指标 | 目标 | 预期实测 | 验收标准 |
|------|------|---------|---------|
| 总响应时间 | 200-500ms | 250-400ms | ✅ 95%ile < 500ms |
| Embedding 延迟 | 20-50ms | 30-60ms (TEI) | ✅ 平均 < 100ms |
| Vector 检索 (热) | 30-50ms | 40-80ms | ✅ 20k chunks < 100ms |
| Vector 检索 (冷) | 100-200ms | 120-250ms | ⚠️ 首次慢可接受 |
| Lexical 检索 | 25-40ms | 30-50ms | ✅ < 60ms |
| RRF 融合 | 5-10ms | 8-15ms | ✅ < 20ms |
| 内存占用 | < 600MB | 500-700MB | ✅ 不超过可用内存 |
| 并发处理 | 10 req/s | 8-12 req/s | ✅ 2 核 CPU 合理 |

### 安全验证

```bash
# 测试跨企业隔离
curl -X POST http://localhost:3001/knowledge-bases/search \
  -H "Authorization: Bearer <enterprise-A-token>" \
  -d '{"query": "test", "instanceId": "<enterprise-B-instance>"}'
# 预期：403 Forbidden 或空结果

# 测试 SQL 注入防护
curl -X POST http://localhost:3001/knowledge-bases/search \
  -H "Authorization: Bearer <token>" \
  -d '{"query": "test'; DROP TABLE text_chunks; --", "instanceId": "xxx"}'
# 预期：正常查询，无 SQL 执行

# 检查 Postgres 查询计划
psql -d sep -c "EXPLAIN ANALYZE 
  SELECT * FROM text_chunks tc
  JOIN knowledge_bases kb ON tc.knowledge_base_id = kb.id
  WHERE kb.enterprise_id = 'xxx' AND kb.id = ANY('{...}');"
# 预期：使用索引 idx_text_chunks_kb_enterprise
```

---

## 部署检查清单

### 环境变量

```bash
# .env
EMBEDDING_PROVIDER=tei
EMBEDDING_BASE_URL=http://embedding:8080
EMBEDDING_MODEL=BAAI/bge-small-zh-v1.5
EMBEDDING_DIMENSION=1024

REDIS_HOST=redis
REDIS_PORT=6379

# Postgres 已有，确保连接池够用
DATABASE_URL=postgresql://...
DATABASE_POOL_SIZE=20  # 增加连接池
```

### Docker Compose

```yaml
services:
  embedding:
    image: ghcr.io/huggingface/text-embeddings-inference:1.5
    command: --model-id BAAI/bge-small-zh-v1.5 --port 8080
    ports:
      - "8080:8080"
    deploy:
      resources:
        limits:
          memory: 512M
          cpus: '1'
    healthcheck:
      test: ["CMD", "curl", "-f", "http://localhost:8080/health"]
      interval: 30s
      timeout: 10s
      retries: 3
  
  redis:
    image: redis:7-alpine
    ports:
      - "6379:6379"
    volumes:
      - redis-data:/data
    command: redis-server --appendonly yes
  
  backend:
    depends_on:
      - postgres
      - redis
      - embedding
    environment:
      - EMBEDDING_BASE_URL=http://embedding:8080

volumes:
  redis-data:
```

### 数据库迁移

```bash
# 1. 备份现有数据
pg_dump sep > backup-$(date +%Y%m%d).sql

# 2. 运行迁移
cd backend
npx prisma migrate deploy

# 3. 创建 pg_trgm 扩展
psql -d sep -c "CREATE EXTENSION IF NOT EXISTS pg_trgm;"

# 4. 验证索引
psql -d sep -c "\d text_chunks"
```

---

## 回滚方案

如果部署失败，按以下步骤回滚：

1. **停止新服务**
```bash
docker-compose stop embedding
docker-compose stop backend
```

2. **恢复数据库**
```bash
psql -d sep < backup-YYYYMMDD.sql
```

3. **回退代码**
```bash
git revert <commit-hash>
git push origin main
```

4. **重启旧版本**
```bash
docker-compose up -d backend
```

---

## 后续优化方向

1. **查询缓存**：LRU 缓存常见查询的 embedding
2. **重排序模型**：使用 Cross-Encoder 对 top 20 结果重排
3. **Query 理解**：同义词扩展、拼写纠错
4. **增量更新**：文档更新时只重新处理变更部分
5. **GPU 加速**：如果迁移到 GPU 服务器，使用 FAISS GPU 版本
6. **多模态**：支持图片/表格的 OCR + 向量化

---

## 总结

本方案通过三层架构（Lexical + Vector + Hybrid Fusion）实现：

✅ **性能目标**：200-500ms 响应时间  
✅ **安全边界**：SQL 层 enterpriseId 强制隔离  
✅ **零外部依赖**：Embedding 独立容器部署  
✅ **资源约束**：内存 < 600MB，充分利用 2 核 CPU  
✅ **可扩展性**：支持每企业 20k chunks，未来可扩展到 100k+  

核心优势：
- **Lexical 保底**：关键词/专名检索不依赖向量
- **Vector 提升**：语义相似匹配，换词也能检索
- **Hybrid 最优**：RRF 融合两者优点，召回率+准确率双高
- **渐进降级**：TEI → WASM → Pure Lexical，保证可用性
