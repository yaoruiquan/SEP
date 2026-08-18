# 知识库生产化计划（并发加固 + 模型服务器部署 + 多模态）

> 日期：2026-08-17
> 对应会议纪要：08-12 会议 P2 §1 企业知识库
> 依据蓝图：`docs/plans/knowledge-redesign-plan.md`
> 状态：待实施（按 Phase A → B → C 顺序推进）

## 一、背景与目标

当前知识库已完成一轮重构：上传 → 解析（pdf-parse / mammoth / 纯文本）→ 分块
（paragraph, 1000 字符 / 100 重叠）→ 向量化（TEI provider）→ 存储
（Prisma Bytes，无 pgvector）→ 混合检索（向量 + BM25, RRF k=60）→ RAG 注入对话。

对照会议 P2 要求，存在三个缺口：

| 缺口 | 现状 | 目标 |
|------|------|------|
| 并发能力未验证 | 上传走 fire-and-forget 异步处理，无队列、无锁 | BullMQ 队列限流 + 并发压测通过 |
| Embedding 模型无服务器部署 | 依赖本地 `localhost:8080`，模型下载不稳定 | docker-compose 内置 TEI 服务 + 环境变量显式化 |
| 多模态未覆盖 | 仅支持 pdf/docx/txt/md | 图片 OCR → 文本管道（音视频后续） |

## 二、Phase A — 并发加固（优先级最高）

### A1. BullMQ 处理队列替换 fire-and-forget

**现状问题**：
- `document.service.ts` 上传后直接 `this.processor.processDocument(id).catch(...)`，
  并发上传会同时发起多个 embedding 请求，TEI 单实例下（实测 2 核约 8-12 req/s）
  容易排队超时或 OOM。
- 进程重启时处理中的文档会永久卡在 `PROCESSING`。

**改动**：
- 新增 `knowledge-queue.service.ts`：封装 BullMQ `Queue('knowledge-processing')`，
  连接现有 Redis（docker-compose 已有 redis:7-alpine）。
- Worker 配置 `concurrency: 2`（蓝图设计值），job = `{ documentId }`。
- `document.service.ts` 上传成功后改为 `queue.add(...)`，不再直接调用 processor。
- job 失败重试 2 次，最终失败 → 文档置 `FAILED` + `lastError`。
- 启动时扫描 `PROCESSING` 超过 10 分钟的文档，重新入队（恢复卡死任务）。

**注册**：queue service 与 processor 注册到 `knowledge.module.ts`；
Redis 连接配置复用现有 `REDIS_HOST/PORT`（若无则补 env）。

### A2. reprocess 状态守卫

**现状问题**：`document-processor.service.ts` 的 `reprocessDocument` 删除旧 chunks
后直接重跑，无状态检查，与正在处理中的任务存在竞态。

**改动**：
- reprocess 前校验 `status`：仅 `READY` / `FAILED` 可重处理；
  `PROCESSING` 直接抛 `ConflictException('文档正在处理中')`。
- 用 Prisma 条件更新（`updateMany({ where: { id, status: { in: [...] } } })`）
  原子地抢占为 `PROCESSING`，count=0 视为抢占失败。

### A3. 并发压测脚本

- 新增 `backend/scripts/load-test-knowledge.ts`（或 shell 脚本）：
  并发上传 N=20 份样本文档（混合 pdf/txt），轮询 `documents/status` 直到全部
  终态，统计：成功率、平均处理耗时、P95 耗时、检索延迟。
- 验收指标（来自蓝图）：全部处理成功、无 OOM、检索延迟 200-500ms。

### Phase A 验收标准
- [ ] 20 并发上传全部进入队列并成功处理，无 500 / 卡死
- [ ] reprocess 与处理中任务并发时返回 409，不产生脏 chunks
- [ ] 杀掉 backend 进程重启后，PROCESSING 卡死文档自动恢复处理

## 三、Phase B — Embedding 模型服务器部署

### B1. docker-compose 增加 TEI 服务

在 `docker-compose.yml` 增加 `embedding` 服务：

```yaml
  embedding:
    image: ghcr.io/huggingface/text-embeddings-inference:1.5
    container_name: sep-embedding
    command: --model-id BAAI/bge-small-zh-v1.5 --port 8080
    ports:
      - "8080:8080"
    volumes:
      - tei_models:/data        # 模型持久化，避免重复下载
    deploy:
      resources:
        limits:
          memory: 512M
    healthcheck:
      test: ["CMD", "curl", "-f", "http://localhost:8080/health"]
      interval: 15s
      timeout: 5s
      retries: 10
      start_period: 120s        # 首次需下载模型，给足启动时间
```

`volumes:` 顶层补 `tei_models:`。NOTE 注释同步更新（compose 管理范围
= PostgreSQL + Redis + TEI）。

### B2. 环境变量显式化

`EmbeddingService` 目前只有代码默认值（`EMBEDDING_PROVIDER=tei`、
`EMBEDDING_BASE_URL=http://localhost:8080`、`EMBEDDING_MODEL=BAAI/bge-small-zh-v1.5`、
`EMBEDDING_DIMENSION=1024`），`.env.example` 中完全没有这些条目。

**改动**：根 `.env.example` 与 `backend/.env.example` 各补一段：

```dotenv
# ===== Embedding（知识库向量化）=====
EMBEDDING_PROVIDER=tei            # tei | openai | wasm
EMBEDDING_BASE_URL=http://localhost:8080   # compose 内用 http://embedding:8080
EMBEDDING_MODEL=BAAI/bge-small-zh-v1.5
EMBEDDING_DIMENSION=1024
```

### B3. 可用性可见性

- 现状：TEI 不可用时静默降级为词法检索，用户无感知。
- 改动：`knowledge-test` 分析接口（analytics）输出中增加 `embeddingAvailable`
  字段（来自 `EmbeddingService.isAvailable()`）；文档处理时若走向量缺失分支，
  在 `lastError` / 日志中记录降级原因。

### Phase B 验收标准
- [ ] `docker-compose up -d` 后 embedding 容器健康，`GET /health` 200
- [ ] backend 连接 TEI 成功，上传文档生成真实向量（非降级词法）
- [ ] TEI 容器停止时，系统降级为词法检索且有明确日志/字段提示

## 四、Phase C — 多模态（文本优先）

会议决策：**文本能力优先，多模态分阶段实施**。

### C1. 图片 OCR → 复用现有文本管道
- `document-parser.service.ts` 当前对非 pdf/docx/text 直接 throw，是硬阻塞点。
- 方案：新增图片解析分支（png/jpg/jpeg），用 `tesseract.js`（中文包 chi_sim）
  提取文本 → 交给现有 `cleanText` + `chunkByParagraphs`，与纯文本一致。
- MIME 白名单（`document.service.ts`）增加 image 类型；大小限制沿用 10MB。
- OCR 结果文本过短（<10 字符）按现有规则拒绝。

### C2. 音视频暂缓
- 在 `docs/plans/PRD-knowledge-base.md` §10 补充说明：音视频转写依赖外部 ASR
  服务选型（待确认事项 #5），本期不实现。

### Phase C 验收标准
- [ ] 上传含中文文字的截图/扫描件，可检索到其中内容
- [ ] 无文字图片返回明确失败原因，不产生空 chunk

## 五、风险与依赖（对齐纪要 §六）

| 风险 | 缓解 |
|------|------|
| 知识库服务器资源不足 | TEI + bge-small-zh 资源占用低（~512M），compose 化后可原样部署到服务器 |
| 模型下载不稳定 | `tei_models` 卷持久化；生产可预置模型目录 |
| 租户隔离 | 检索已按 enterprise 过滤（vector.service LRU 按企业缓存）；原始数据与向量同库部署，安全评估结论待确认事项 #5 |
| 向量暴力检索扩展性 | 当前 Bytes + JS 余弦，量级上来后迁移 pgvector（另立计划，不在本期） |

## 六、任务清单

| # | 任务 | 文件 | 依赖 |
|---|------|------|------|
| A1 | BullMQ 队列 + Worker (concurrency=2) | knowledge-queue.service.ts（新）、document.service.ts、knowledge.module.ts | Redis |
| A2 | reprocess 状态守卫 | document-processor.service.ts | — |
| A3 | 并发压测脚本 | backend/scripts/load-test-knowledge.ts | A1 |
| B1 | compose embedding 服务 | docker-compose.yml | — |
| B2 | EMBEDDING_* env 显式化 | .env.example × 2 | — |
| B3 | 可用性可见性 | knowledge-analytics / document-processor | — |
| C1 | 图片 OCR 管道 | document-parser.service.ts、document.service.ts | tesseract.js |
| C2 | 音视频暂缓说明 | PRD-knowledge-base.md | — |

## 七、不在本期范围

- pgvector 迁移（量大后再议）
- 音视频转写、多模态 embedding 模型选型
- 知识库对外 API Key 接口（用户已明确跳过）
