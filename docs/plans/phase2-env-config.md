# Phase 2 RAG 功能环境变量配置

## 必需的环境变量

在 `/Users/yao/LLM/SEP/.env` 文件中添加以下配置：

```bash
# ==================== Pinecone 向量数据库 ====================
PINECONE_API_KEY=your_pinecone_api_key_here
PINECONE_INDEX=sep-knowledge

# ==================== OpenAI Embeddings ====================
OPENAI_API_KEY=your_openai_api_key_here
OPENAI_BASE_URL=https://api.openai.com/v1  # 可选，默认为官方地址

# 或使用 sub2api 中转（推荐）
OPENAI_BASE_URL=https://your-sub2api-endpoint/v1
```

## 获取 API Keys

### Pinecone

1. 访问 https://www.pinecone.io/
2. 注册并登录
3. 创建一个 Index：
   - Name: `sep-knowledge`
   - Dimensions: `1536` (匹配 text-embedding-3-small)
   - Metric: `cosine`
4. 在 API Keys 页面获取 API Key

### OpenAI

1. 访问 https://platform.openai.com/
2. 登录并创建 API Key
3. 复制 API Key

**注意**：按照 CLAUDE.md，生产环境应该通过 sub2api 中转所有模型调用，而不是直接连接 OpenAI。

## 验证配置

启动后端后，检查日志：

```bash
pnpm dev:backend
```

应该看到：
- `✓ Pinecone initialized successfully`
- `✓ OpenAI embedding service initialized`

如果没有配置，会看到警告：
- `⚠ PINECONE_API_KEY not configured, vector search disabled`
- `⚠ OPENAI_API_KEY not configured, embedding service disabled`

## 功能降级

如果没有配置 Pinecone 或 OpenAI，系统会自动降级到**全文搜索**：

- 使用 PostgreSQL 的 `LIKE` 查询
- 搜索 `TextChunk.content` 和 `TextChunk.title`
- 返回固定相似度分数 `0.8`

这样即使没有向量数据库，基本的搜索功能仍然可用。

## 测试配置

可以使用 `.env.test` 或 `.env.local` 进行测试配置：

```bash
# .env.test
PINECONE_API_KEY=test_key
PINECONE_INDEX=sep-knowledge-test
OPENAI_API_KEY=test_key
```

运行测试：

```bash
NODE_ENV=test pnpm dev:backend
```

## 环境变量优先级

NestJS 会按以下顺序读取环境变量：

1. 系统环境变量
2. `.env.local` (本地开发，git ignore)
3. `.env.development` / `.env.production`
4. `.env`

推荐本地开发使用 `.env.local` 存储敏感 API Keys。
