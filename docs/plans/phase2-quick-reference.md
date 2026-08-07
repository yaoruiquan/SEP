# Phase 2 RAG 功能快速参考

## 🎯 当前状态

✅ **已完成** (Week 3 + Week 4 Part 1)
- 向量数据库集成 (Pinecone)
- 文档解析 (PDF/Word/TXT/Markdown)
- 文本分块 (1000 字符/块)
- 向量嵌入 (OpenAI text-embedding-3-small)
- 异步文档处理流水线
- 知识库检索 API

⏸️ **待实现** (Week 4 Part 2)
- 对话系统集成
- Prompt 工程
- 前端引用显示

---

## 🔑 核心 API

### 1. 上传文档（自动处理）
```http
POST /knowledge/{knowledgeBaseId}/documents
Content-Type: multipart/form-data

file: <文件>
title: "文档标题"
```

处理流程：PENDING → PROCESSING → COMPLETED/FAILED

### 2. 检索（按员工实例）
```http
POST /knowledge/search
Content-Type: application/json

{
  "query": "用户问题",
  "instanceId": "员工实例 ID",
  "topK": 5,
  "scoreThreshold": 0.7
}
```

### 3. 检索（按知识库 ID）
```http
POST /knowledge/search/by-knowledge-base

{
  "query": "用户问题",
  "knowledgeBaseIds": ["kb1", "kb2"],
  "topK": 5,
  "scoreThreshold": 0.7
}
```

---

## 📦 核心服务

| 服务 | 职责 |
|------|------|
| `DocumentParserService` | 解析 PDF/Word/TXT/Markdown |
| `TextChunker` | 智能文本分块（段落感知）|
| `EmbeddingService` | OpenAI 向量嵌入 |
| `VectorService` | Pinecone 向量操作 |
| `DocumentProcessorService` | 编排处理流水线 |
| `KnowledgeSearchService` | 检索逻辑 + 降级 |

---

## ⚙️ 环境配置

```bash
# .env
PINECONE_API_KEY=pc-xxx
PINECONE_INDEX=sep-knowledge
OPENAI_API_KEY=sk-xxx
```

**Pinecone Index 设置**:
- Dimensions: 1536
- Metric: cosine
- Pods: Starter (免费)

---

## 🧪 测试

```bash
# 启动后端
pnpm dev:backend

# 测试 Phase 2 检索
node test-phase2-search.js

# Swagger 文档
open http://localhost:3001/api/docs
```

---

## 🔄 文档处理流水线

```
上传 → 解析 → 分块 → 向量化 → 存储
 │      │      │       │        ├─ PostgreSQL (TextChunk)
 │      │      │       │        └─ Pinecone (vectors)
 │      │      │       │
 │      │      │       └─ EmbeddingService (OpenAI)
 │      │      └─ TextChunker (1000 chars + 100 overlap)
 │      └─ DocumentParserService (pdf-parse/mammoth)
 └─ DocumentService (触发异步处理)
```

---

## 🚨 故障降级

**没有 Pinecone/OpenAI**:
- ✅ 自动切换到 PostgreSQL 全文搜索
- ✅ 搜索 `content` 和 `title` 字段
- ✅ 返回固定分数 0.8

**文档处理失败**:
- 状态标记为 `FAILED`
- 可通过 `POST /:id/reprocess` 重试

---

## 📋 下一步（Week 4 Part 2）

1. **ConversationService**
   ```typescript
   // 在生成回复前
   const context = await knowledgeSearch.search(
     message.content,
     conversation.instanceId
   );
   
   // 注入 system prompt
   const prompt = buildPromptWithContext(context);
   ```

2. **Prompt 模板**
   ```
   参考知识库：
   [chunk 1 - source.pdf]
   [chunk 2 - guide.docx]
   
   用户: {query}
   
   基于上述内容回答，无相关信息时说明。
   ```

3. **前端展示**
   - 显示 "📚 基于知识库回答"
   - 列出引用来源（可点击）

---

## 📁 关键文件

```
backend/src/modules/knowledge/
├── knowledge-search.service.ts      ← 检索核心
├── search.controller.ts             ← API 端点
├── document-processor.service.ts    ← 处理编排
├── vector.service.ts                ← Pinecone 封装
├── embedding.service.ts             ← OpenAI 嵌入
├── document-parser.service.ts       ← 文档解析
└── text-chunker.util.ts             ← 分块工具

test-phase2-search.js                ← 端到端测试
docs/plans/phase2-env-config.md      ← 配置指南
```
