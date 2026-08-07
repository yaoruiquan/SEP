# Phase 2: RAG 检索功能开发

## 目标
为知识库系统添加 RAG（检索增强生成）能力，使数字员工能够基于知识库内容回答问题。

## 进度

- ✅ Week 3: 向量化和检索（已完成）
- ✅ Week 4 Part 1: 知识库检索 API（已完成）
- ⏸️ Week 4 Part 2: 对话系统集成（待实现）

## Week 3: 向量化和检索 ✅

### Day 1-2: 向量数据库集成

**技术选型**：
- 使用 Pinecone 作为向量数据库（云服务，易于集成）
- 备选方案：Weaviate（可自部署）

**任务**：
1. 安装依赖：`@pinecone-database/pinecone`
2. 创建 VectorService 封装向量数据库操作
3. 配置环境变量（PINECONE_API_KEY, PINECONE_INDEX）
4. 实现基础操作：
   - 初始化索引
   - 插入向量
   - 查询相似向量
   - 删除向量

### Day 3: 文档解析和分块

**文档解析**：
- PDF: 使用 `pdf-parse`
- Word: 使用 `mammoth`
- TXT/Markdown: 直接读取

**文本分块策略**：
- 块大小: 500-1000 tokens
- 重叠: 50-100 tokens（保持上下文连贯性）
- 分块边界: 尽量按段落或句子分割

**任务**：
1. 创建 DocumentParserService
2. 实现各格式文档解析器
3. 创建 TextChunker 工具类
4. 处理特殊格式（表格、列表）

### Day 4-5: 向量化流程

**Embedding 模型**：
- 使用 OpenAI text-embedding-3-small（性价比高）
- 备选：text-embedding-3-large（更高质量）

**向量化流程**：
1. 文档上传 → 触发异步处理
2. 解析文档 → 提取文本
3. 文本分块 → 生成 chunks
4. 调用 Embedding API → 获取向量
5. 存储向量到 Pinecone
6. 更新文档状态（PROCESSING → COMPLETED/FAILED）

**任务**：
1. 创建 EmbeddingService
2. 集成 OpenAI Embeddings API
3. 实现异步处理队列（使用 Bull + Redis）
4. 错误处理和重试机制

## Week 4: RAG 集成

### Day 1-2: 对话系统集成检索逻辑

**检索流程**：
1. 接收用户消息
2. 查询该员工授权的知识库列表
3. 将用户问题向量化
4. 在向量数据库中检索相关片段（topK=3-5）
5. 过滤低相似度结果（threshold=0.7）
6. 返回相关上下文

**任务**：
1. 修改 ConversationService
2. 在生成回复前插入检索步骤
3. 实现知识库授权检查
4. 添加检索结果排序和过滤

### Day 3: Prompt 工程和上下文构建

**Prompt 模板**：
```
你是 [员工名称]，[员工描述]。

参考以下知识库内容回答用户问题：
---
[检索到的文本片段1]
来源: [文档名称]

[检索到的文本片段2]
来源: [文档名称]
---

用户问题: [用户消息]

请基于上述知识库内容回答。如果知识库中没有相关信息，请诚实告知用户。
```

**任务**：
1. 设计 System Prompt 模板
2. 实现上下文拼接逻辑
3. 控制上下文长度（避免超出 token 限制）
4. 添加来源引用

### Day 4-5: 测试和优化

**测试内容**：
1. 端到端流程测试
2. 检索质量评估
3. 性能测试（响应时间）
4. 边界情况处理

**优化方向**：
1. 调整检索参数（topK, threshold）
2. 改进分块策略
3. 添加缓存机制
4. 监控和日志

## 数据库变更

无需新增表，使用现有：
- `Document` - 文档元数据
- `TextChunk` - 文本片段（已有 embedding 字段用于存储向量 ID）
- `KnowledgeGrant` - 授权关系

## API 端点

### 内部 API（对话系统调用）
```
POST /knowledge/search
Body:
{
  "query": "用户问题",
  "instanceId": "员工实例ID",
  "topK": 3,
  "scoreThreshold": 0.7
}

Response:
{
  "chunks": [
    {
      "content": "文本内容",
      "source": "文档名称",
      "score": 0.85,
      "knowledgeBaseId": "xxx"
    }
  ]
}
```

### 管理 API（触发重新处理）
```
POST /knowledge/:id/documents/:docId/reprocess
- 重新解析和向量化文档
```

## 环境变量配置

```env
# OpenAI (用于 Embedding)
OPENAI_API_KEY=sk-xxx

# Pinecone
PINECONE_API_KEY=xxx
PINECONE_ENVIRONMENT=us-east-1
PINECONE_INDEX=sep-knowledge

# Redis (用于任务队列)
REDIS_HOST=localhost
REDIS_PORT=6379
```

## 依赖安装

```bash
# 后端
pnpm add @pinecone-database/pinecone
pnpm add openai
pnpm add pdf-parse
pnpm add mammoth
pnpm add bull
pnpm add @nestjs/bull
```

## 风险和限制

1. **成本考虑**：
   - OpenAI Embeddings API 按 token 计费
   - Pinecone 免费套餐限制（100K 向量）

2. **性能瓶颈**：
   - 大文件解析耗时
   - Embedding API 有速率限制

3. **质量问题**：
   - 复杂格式（表格、图表）解析可能失败
   - 中文分词可能影响检索效果

## 下一步

开始 Week 3 Day 1-2: 向量数据库集成
