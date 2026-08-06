# 知识库功能 PRD（产品需求文档）

## 1. 产品概述

### 1.1 功能定位
知识库为数字员工提供企业专有知识支持，通过 RAG（检索增强生成）技术，让 AI 基于企业文档、FAQ、业务规范等内容回答问题，提升回答的准确性和专业性。

### 1.2 核心价值
- **准确性提升**：AI 回答基于企业真实文档，减少幻觉
- **知识复用**：企业知识结构化管理，多员工共享
- **灵活管理**：支持多种内容来源，按主题分类管理
- **权限控制**：不同员工访问不同知识范围

### 1.3 用户角色
- **企业管理员**：创建、管理知识库，授权员工使用
- **企业成员**：查看被授权的知识库，在对话中使用
- **数字员工**：自动检索相关知识，增强回答质量

---

## 2. 功能需求

### 2.1 知识库管理

#### 2.1.1 知识库 CRUD
- **创建知识库**
  - 必填：名称（50 字以内）
  - 可选：描述（500 字以内）
  - 自动记录创建人和创建时间
  - 归属当前企业

- **编辑知识库**
  - 修改名称、描述
  - 仅创建人或企业管理员可编辑

- **删除知识库**
  - 级联删除：关联的文档、文本片段、授权记录
  - 二次确认弹窗
  - 仅创建人或企业管理员可删除

- **知识库列表**
  - 显示：名称、描述、文档数、授权员工数、创建人、更新时间
  - 排序：按更新时间倒序
  - 搜索：按名称模糊搜索
  - 分页：每页 20 条

#### 2.1.2 知识库分类（Phase 2）
- 支持按主题分组：产品知识、客服话术、技术文档、业务流程等
- 员工可绑定多个知识库
- 检索时按绑定优先级排序

### 2.2 内容管理

#### 2.2.1 文件上传
**支持格式（MVP）**：
- 文档：PDF、Word（.docx）、TXT、Markdown
- 网页：HTML
- 结构化：JSON、CSV

**上传流程**：
1. 前端选择文件，校验大小（单文件 ≤ 10MB）和格式
2. 上传到后端，存储到本地文件系统（`./uploads/documents/`）
3. 创建 `Document` 记录，状态为 `PENDING`
4. 后台解析文档内容
5. 分块（chunk）并向量化，存储到向量数据库
6. 更新状态为 `READY`

**文档列表**：
- 显示：文件名、大小、上传人、上传时间、状态
- 操作：下载、删除、重新解析
- 状态标识：PENDING（解析中）、READY（可用）、FAILED（失败）

#### 2.2.2 手动输入文本片段
**使用场景**：
- FAQ 问答对
- 业务规则说明
- 快速补充知识

**字段**：
- 标题（必填，100 字以内）
- 内容（必填，5000 字以内）
- 标签（可选，多选）

**管理**：
- 列表展示：标题、内容预览、创建时间
- 编辑、删除操作
- 搜索：按标题或内容搜索

#### 2.2.3 外部数据源同步（Phase 2）
- API 连接：定期拉取外部知识内容
- 数据库连接：同步企业内部数据库的特定表
- Webhook：接收外部系统推送的知识更新

### 2.3 权限管理

#### 2.3.1 授权模型
知识库通过 `KnowledgeGrant` 表授权给：
- **员工实例**（`instanceId`）：特定数字员工可访问
- **部门**（`departmentId`）：部门下所有员工可访问

**授权规则**：
- 一个知识库可授权给多个实例/部门
- 一个实例可访问多个知识库
- 授权采用白名单模式：未授权的员工无法访问

#### 2.3.2 授权管理界面
**位置**：知识库详情页 → 授权管理 Tab

**功能**：
- 添加授权：选择员工实例或部门
- 查看已授权：列表显示已授权的对象
- 移除授权：取消特定实例/部门的访问权限

### 2.4 RAG 检索

#### 2.4.1 检索流程
1. **用户提问** → 会话系统接收消息
2. **判断是否需要检索**：
   - 检查当前员工绑定的知识库
   - 判断问题类型（是否需要知识支持）
3. **向量检索**：
   - 将用户问题向量化
   - 在向量数据库中检索 Top-K 相关片段（K=3-5）
   - 计算相似度得分，过滤低分结果（阈值 0.7）
4. **上下文构建**：
   - 将检索结果格式化为 context
   - 拼接到 system prompt 或 user message 中
5. **AI 生成回答**：
   - LLM 基于检索到的知识生成回答
   - 标注引用来源（文档名称、页码）

#### 2.4.2 向量数据库集成
**技术选型**：Pinecone / Weaviate（根据团队偏好）

**数据结构**：
- **向量维度**：使用 OpenAI `text-embedding-3-small`（1536 维）
- **元数据**：
  - `knowledgeBaseId`: 知识库 ID
  - `documentId`: 文档 ID（如果来源于文件）
  - `chunkId`: 片段 ID
  - `content`: 原始文本内容
  - `source`: 来源标识（文件名或标题）
  - `enterpriseId`: 企业 ID（多租户隔离）

**检索策略**：
- 混合检索：向量相似度 + 关键词匹配
- 重排序：使用 reranking 模型优化结果顺序
- 多召回：从不同知识库并行检索，合并结果

#### 2.4.3 提示词设计
```
系统提示词模板：
你是 {员工名称}，一名专业的 {职位}。

以下是相关的企业知识库内容，请基于这些信息回答用户问题：

<knowledge>
[来源: {文档名}]
{检索到的内容片段 1}

[来源: {文档名}]
{检索到的内容片段 2}
</knowledge>

如果知识库中没有相关信息，请基于你的专业知识回答，但要明确告知用户这不是企业文档的内容。
回答时请引用来源，格式：（来源：文档名）
```

---

## 3. 数据库设计

### 3.1 现有表结构
```prisma
model KnowledgeBase {
  id           String   @id @default(cuid())
  enterpriseId String
  name         String
  description  String?  @db.Text
  createdBy    String
  createdAt    DateTime @default(now())
  updatedAt    DateTime @updatedAt

  enterprise Enterprise       @relation(...)
  creator    User             @relation(...)
  documents  Document[]
  grants     KnowledgeGrant[]
  textChunks TextChunk[]      // 新增：手动输入的文本片段
}

model Document {
  id              String         @id @default(cuid())
  knowledgeBaseId String
  filename        String
  originalName    String
  fileSize        Int
  mimeType        String
  storagePath     String
  status          DocumentStatus @default(PENDING)
  uploadedBy      String
  createdAt       DateTime       @default(now())
  updatedAt       DateTime       @updatedAt

  knowledgeBase KnowledgeBase @relation(...)
  uploader      User          @relation(...)
}

enum DocumentStatus {
  PENDING  // 上传中
  READY    // 可用
  FAILED   // 解析失败
}

model KnowledgeGrant {
  id              String   @id @default(cuid())
  knowledgeBaseId String
  instanceId      String?  // 授权给特定员工实例
  departmentId    String?  // 授权给部门（部门下所有实例可用）
  createdAt       DateTime @default(now())

  knowledgeBase KnowledgeBase    @relation(...)
  instance      EmployeeInstance? @relation(...)
  department    Department?       @relation(...)
}
```

### 3.2 需要新增的表

#### 3.2.1 TextChunk（文本片段）
用于存储手动输入的知识片段和文档分块后的内容。

```prisma
model TextChunk {
  id              String   @id @default(cuid())
  knowledgeBaseId String
  title           String?  // 片段标题（手动输入时必填）
  content         String   @db.Text
  source          String   // 来源：文档 ID 或 "manual"
  tags            String[] // 标签（手动输入时可用）
  vectorId        String?  // 向量数据库中的 ID
  createdBy       String?
  createdAt       DateTime @default(now())
  updatedAt       DateTime @updatedAt

  knowledgeBase KnowledgeBase @relation(...)
  creator       User?         @relation(...)

  @@index([knowledgeBaseId])
  @@map("text_chunks")
}
```

#### 3.2.2 KnowledgeUsageLog（知识库使用日志）
用于统计和分析知识库的使用情况。

```prisma
model KnowledgeUsageLog {
  id              String   @id @default(cuid())
  knowledgeBaseId String
  sessionId       String   // 会话 ID
  query           String   @db.Text // 用户问题
  retrievedChunks Int      // 检索到的片段数
  createdAt       DateTime @default(now())

  knowledgeBase KnowledgeBase       @relation(...)
  session       ConversationSession @relation(...)

  @@index([knowledgeBaseId])
  @@index([sessionId])
  @@map("knowledge_usage_logs")
}
```

---

## 4. API 设计

### 4.1 知识库管理

#### POST /knowledge-bases
创建知识库
```typescript
Request Body:
{
  name: string;        // 必填，50 字以内
  description?: string; // 可选，500 字以内
}

Response:
{
  id: string;
  name: string;
  description: string | null;
  enterpriseId: string;
  createdBy: string;
  createdAt: string;
  updatedAt: string;
}
```

#### GET /knowledge-bases
获取知识库列表
```typescript
Query Params:
{
  page?: number;    // 默认 1
  pageSize?: number; // 默认 20
  search?: string;   // 按名称搜索
}

Response:
{
  data: KnowledgeBase[];
  total: number;
  page: number;
  pageSize: number;
}
```

#### GET /knowledge-bases/:id
获取知识库详情

#### PATCH /knowledge-bases/:id
更新知识库

#### DELETE /knowledge-bases/:id
删除知识库

### 4.2 文档管理

#### POST /knowledge-bases/:id/documents
上传文档
```typescript
Content-Type: multipart/form-data

Request:
{
  file: File; // 文档文件
}

Response:
{
  id: string;
  filename: string;
  originalName: string;
  fileSize: number;
  mimeType: string;
  status: 'PENDING' | 'READY' | 'FAILED';
  uploadedBy: string;
  createdAt: string;
}
```

#### GET /knowledge-bases/:id/documents
获取文档列表

#### DELETE /knowledge-bases/:kbId/documents/:docId
删除文档

### 4.3 文本片段管理

#### POST /knowledge-bases/:id/chunks
创建文本片段
```typescript
Request Body:
{
  title: string;      // 必填，100 字以内
  content: string;    // 必填，5000 字以内
  tags?: string[];    // 可选标签
}
```

#### GET /knowledge-bases/:id/chunks
获取片段列表

#### PATCH /knowledge-bases/:kbId/chunks/:chunkId
更新片段

#### DELETE /knowledge-bases/:kbId/chunks/:chunkId
删除片段

### 4.4 授权管理

#### POST /knowledge-bases/:id/grants
添加授权
```typescript
Request Body:
{
  instanceId?: string;   // 员工实例 ID（二选一）
  departmentId?: string; // 部门 ID（二选一）
}
```

#### GET /knowledge-bases/:id/grants
获取授权列表

#### DELETE /knowledge-bases/:kbId/grants/:grantId
移除授权

### 4.5 检索接口（内部）

#### POST /knowledge/search
RAG 检索（内部 API，对话系统调用）
```typescript
Request Body:
{
  query: string;         // 用户问题
  instanceId: string;    // 员工实例 ID
  topK?: number;         // 返回结果数，默认 3
  scoreThreshold?: number; // 相似度阈值，默认 0.7
}

Response:
{
  chunks: Array<{
    content: string;
    source: string;      // 来源（文档名或标题）
    score: number;       // 相似度得分
    knowledgeBaseId: string;
  }>;
}
```

---

## 5. 前端界面设计

### 5.1 导航入口
**位置**：企业管理台左侧导航 → 协作 → 知识库

### 5.2 知识库列表页
**路由**：`/knowledge`

**布局**：
```
┌─────────────────────────────────────────────────────┐
│ 知识库                               [+ 新建知识库] │
├─────────────────────────────────────────────────────┤
│ [搜索框...]                                         │
├─────────────────────────────────────────────────────┤
│ ┌─────────────────────────────────────────────────┐ │
│ │ 产品手册                              [管理] [×] │ │
│ │ 包含产品功能、使用指南等内容                     │ │
│ │ 📄 15 个文档 · 👥 授权 3 个员工 · 更新于 2 小时前│ │
│ └─────────────────────────────────────────────────┘ │
│ ┌─────────────────────────────────────────────────┐ │
│ │ 客服话术库                            [管理] [×] │ │
│ │ 常见问题回答模板和服务规范                       │ │
│ │ 📄 8 个文档 · 📝 20 个片段 · 👥 授权 5 个员工    │ │
│ └─────────────────────────────────────────────────┘ │
└─────────────────────────────────────────────────────┘
```

### 5.3 知识库详情页
**路由**：`/knowledge/:id`

**Tab 切换**：
1. **文档** - 上传的文件列表
2. **片段** - 手动输入的文本片段
3. **授权** - 授权管理
4. **设置** - 基本信息编辑

**文档 Tab**：
```
┌─────────────────────────────────────────────────────┐
│ [上传文档]                           [批量删除]     │
├─────────────────────────────────────────────────────┤
│ ☑ 产品介绍.pdf          2.5MB  ✓ 已就绪  [下载][×] │
│ ☑ 使用手册.docx         1.8MB  ⏳ 解析中  [×]      │
│ ☐ FAQ.txt              156KB  ✓ 已就绪  [下载][×] │
└─────────────────────────────────────────────────────┘
```

**片段 Tab**：
```
┌─────────────────────────────────────────────────────┐
│ [+ 新建片段]                         [搜索...]      │
├─────────────────────────────────────────────────────┤
│ 如何申请退款                                 [编辑] │
│ 用户需要提供订单号和退款原因...                     │
│ 标签: #客服 #退款流程           更新于 2024-08-05  │
├─────────────────────────────────────────────────────┤
│ 会员权益说明                                 [编辑] │
│ VIP 会员享有以下特权：1. 专属客服...                │
│ 标签: #产品 #会员                  更新于 2024-08-04 │
└─────────────────────────────────────────────────────┘
```

**授权 Tab**：
```
┌─────────────────────────────────────────────────────┐
│ [添加授权]                                          │
├─────────────────────────────────────────────────────┤
│ 授权类型        名称                      操作      │
├─────────────────────────────────────────────────────┤
│ 员工实例    客服主管·王芳               [移除]     │
│ 员工实例    电商运营总监·李明           [移除]     │
│ 部门        客服部                       [移除]     │
└─────────────────────────────────────────────────────┘
```

### 5.4 新建/编辑弹窗
**知识库表单**：
- 名称（必填，文本框）
- 描述（可选，多行文本框）

**文本片段表单**：
- 标题（必填，文本框）
- 内容（必填，富文本编辑器或多行文本框）
- 标签（可选，标签选择器）

---

## 6. 技术实现

### 6.1 后端模块

#### 6.1.1 KnowledgeModule
负责知识库的 CRUD 和业务逻辑。

**主要文件**：
- `knowledge/knowledge.module.ts` - 模块定义
- `knowledge/knowledge.service.ts` - 业务逻辑
- `knowledge/knowledge.controller.ts` - API 控制器
- `knowledge/dto/` - DTO 定义

#### 6.1.2 DocumentModule
负责文档上传、解析、分块。

**主要文件**：
- `document/document.service.ts` - 文档处理
- `document/document-parser.service.ts` - 文档解析（PDF、Word、TXT）
- `document/document-chunker.service.ts` - 文本分块

**依赖**：
- `pdf-parse` - PDF 解析
- `mammoth` - Word 解析
- `cheerio` - HTML 解析

#### 6.1.3 VectorModule
负责向量化和检索。

**主要文件**：
- `vector/vector.service.ts` - 向量数据库操作
- `vector/embedding.service.ts` - 文本向量化（调用 OpenAI Embedding API）

**依赖**：
- `@pinecone-database/pinecone` 或 `weaviate-ts-client`

#### 6.1.4 RAG 集成
在 `ConversationStreamService` 中集成检索逻辑：

```typescript
async streamConversation(sessionId: string, userMessage: string) {
  // 1. 获取员工实例绑定的知识库
  const instance = await this.getInstanceBySession(sessionId);
  const knowledgeBases = await this.knowledgeService.getGrantedKnowledgeBases(instance.id);

  // 2. 检索相关知识
  const context = await this.vectorService.search({
    query: userMessage,
    knowledgeBaseIds: knowledgeBases.map(kb => kb.id),
    topK: 3,
  });

  // 3. 构建 prompt（将检索结果拼接到 system message）
  const systemPrompt = this.buildSystemPrompt(instance, context);

  // 4. 调用 LLM 流式生成
  return this.streamLLM(systemPrompt, userMessage);
}
```

### 6.2 前端模块

#### 6.2.1 知识库页面
- `/web/src/app/(enterprise)/knowledge/page.tsx` - 列表页
- `/web/src/app/(enterprise)/knowledge/[id]/page.tsx` - 详情页

#### 6.2.2 Hooks
- `use-knowledge-bases.ts` - 知识库 CRUD
- `use-documents.ts` - 文档管理
- `use-text-chunks.ts` - 文本片段管理
- `use-knowledge-grants.ts` - 授权管理

#### 6.2.3 组件
- `KnowledgeList.tsx` - 知识库列表
- `KnowledgeDetailTabs.tsx` - 详情页 Tab 切换
- `DocumentUploader.tsx` - 文档上传
- `TextChunkEditor.tsx` - 片段编辑器
- `GrantManager.tsx` - 授权管理

---

## 7. 开发计划

### Phase 1: 基础功能（2 周）
**Week 1: 后端开发**
- Day 1-2: 数据库 schema 补充（TextChunk、KnowledgeUsageLog）
- Day 3-4: KnowledgeModule CRUD API
- Day 5: DocumentModule 文件上传和存储

**Week 2: 前端开发**
- Day 1-2: 知识库列表页和详情页布局
- Day 3-4: 文档上传组件
- Day 5: 文本片段管理界面

### Phase 2: RAG 检索（2 周）
**Week 3: 向量化和检索**
- Day 1-2: 集成 Pinecone/Weaviate
- Day 3: 文档解析和分块
- Day 4-5: 向量化流程（Embedding API 调用）

**Week 4: RAG 集成**
- Day 1-2: 对话系统集成检索逻辑
- Day 3: Prompt 工程和上下文构建
- Day 4-5: 测试和优化

### Phase 3: 授权和优化（1 周）
**Week 5**
- Day 1-2: 授权管理功能
- Day 3: 知识库使用日志
- Day 4: 性能优化和缓存
- Day 5: 文档和部署

---

## 8. 测试要点

### 8.1 单元测试
- 文档解析器：PDF、Word、TXT 格式正确解析
- 文本分块器：按语义分块，块大小合理（500-1000 tokens）
- 向量服务：向量化和检索结果准确

### 8.2 集成测试
- 上传文档 → 解析 → 向量化 → 检索流程
- 授权机制：未授权员工无法访问知识库
- RAG 生成：检索结果正确拼接到 prompt

### 8.3 端到端测试
- 用户上传文档 → 对话中使用 → 回答准确且引用来源
- 知识库授权 → 不同员工访问不同知识

---

## 9. 风险和限制

### 9.1 技术风险
- **向量数据库成本**：Pinecone 有使用量限制，需监控成本
- **文档解析准确性**：复杂格式（表格、图片）可能解析失败
- **检索质量**：Embedding 模型可能对领域专有词汇效果不佳

### 9.2 产品限制
- MVP 阶段不支持图片、视频等多模态内容
- 不支持实时更新（文档修改需重新上传）
- 不支持版本管理（知识库内容变更无历史记录）

### 9.3 缓解措施
- 提供文档解析失败的错误提示，支持手动补充
- 允许用户手动输入文本片段作为补充
- 在 Phase 2 加入重排序（reranking）提升检索质量

---

## 10. 未来规划

### Phase 4: 高级功能（后续迭代）
- **知识图谱**：实体关系抽取，构建企业知识图谱
- **智能问答**：基于知识库自动生成 FAQ
- **多模态支持**：图片、视频内容索引和检索
- **协同编辑**：多人共同维护知识库
- **版本管理**：知识内容变更历史和回滚
- **智能推荐**：根据员工使用情况推荐相关知识库

---

## 11. 附录

### 11.1 参考文档
- [Pinecone 文档](https://docs.pinecone.io/)
- [OpenAI Embeddings API](https://platform.openai.com/docs/guides/embeddings)
- [LangChain RAG 指南](https://python.langchain.com/docs/use_cases/question_answering/)

### 11.2 术语表
- **RAG**：Retrieval-Augmented Generation，检索增强生成
- **Embedding**：文本向量化表示
- **Chunk**：文本分块，RAG 检索的基本单位
- **Reranking**：重排序，对检索结果二次排序提升质量
- **Knowledge Grant**：知识库授权记录

---

**文档版本**：v1.0  
**创建日期**：2026-08-06  
**负责人**：开发团队  
**审核人**：产品负责人
