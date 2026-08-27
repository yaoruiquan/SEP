# 项目开发状态报告 - 2026-08-18

> **历史状态快照，禁止作为当前部署指引。** 当前知识库已升级为 Ollama `bge-m3:latest`（1024 维）+ PostgreSQL pgvector/HNSW，部署以[当前指南](../deployment/embedding-service.md)为准。

## 📊 当前进度总览

### 已完成的核心功能

| 模块 | 状态 | 最后更新 |
|------|------|----------|
| 认证授权 | ✅ | JWT + httpOnly cookie |
| 用户管理 | ✅ | 企业/用户 CRUD |
| 订阅系统 | ✅ | 申请审批流程 |
| 计算配额 | ✅ | 三级配额系统（平台/企业/员工） |
| 支付集成 | ✅ | 支付宝生产环境 (commit 7965007) |
| 知识库核心 | ✅ | 上传/解析/分块/向量化/混合检索 |
| **Phase B (Embedding)** | ✅ | **环境变量规范化 (commit 4ee77df)** |

### 知识库生产化计划进度

```
Phase A - 并发加固              ⚠️  未开始（最高优先级）
├── A1: BullMQ 队列             ⬜ 待实现
├── A2: reprocess 状态守卫      ⬜ 待实现
└── A3: 并发压测脚本            ⬜ 待实现

Phase B - Embedding 服务        ✅  已完成
├── B1: docker-compose 配置     ✅ Infinity Server (生产环境就绪)
├── B2: 环境变量规范化          ✅ 开发/生产配置完整
└── B3: 可用性监控              ⚠️  待实现（低优先级）

Phase C - 多模态                ⚠️  未开始
├── C1: 图片 OCR                ⬜ tesseract.js + chi_sim
└── C2: 音视频暂缓说明          ⬜ 文档补充
```

---

## 🚀 下一步开发任务

### 立即执行：Phase A - 并发加固（最高优先级）

#### 原因
- 当前知识库上传使用 `fire-and-forget` 异步处理
- 并发上传会同时发起多个 embedding 请求，容易超时/OOM
- 进程重启时处理中的文档会永久卡在 `PROCESSING` 状态

#### A1: BullMQ 队列替换 fire-and-forget

**文件变更**：
```
backend/src/modules/knowledge/
├── knowledge-queue.service.ts      (新建) - BullMQ 队列封装
├── document.service.ts             (修改) - 上传后入队，不直接调用 processor
├── document-processor.service.ts   (修改) - 作为 Worker job handler
└── knowledge.module.ts             (修改) - 注册 queue service
```

**实现要点**：
- 连接现有 Redis（`docker-compose.yml` 已有 `redis:7-alpine`）
- Worker 配置 `concurrency: 2`（来自蓝图设计）
- Job 失败重试 2 次，最终失败 → 文档置 `FAILED` + `lastError`
- 启动时扫描 `PROCESSING` 超过 10 分钟的文档，重新入队

**依赖**：
```bash
pnpm add bullmq --filter backend
```

#### A2: reprocess 状态守卫

**文件变更**：
```
backend/src/modules/knowledge/document-processor.service.ts
```

**实现要点**：
- `reprocessDocument` 前校验 `status`：仅 `READY` / `FAILED` 可重处理
- `PROCESSING` 状态直接抛 `ConflictException('文档正在处理中')`
- 使用 Prisma 条件更新原子地抢占为 `PROCESSING`

#### A3: 并发压测脚本

**文件变更**：
```
backend/scripts/load-test-knowledge.ts (新建)
```

**验收指标**（来自蓝图）：
- ✅ 20 并发上传全部处理成功，无 500 / 卡死
- ✅ 无 OOM
- ✅ 检索延迟 200-500ms
- ✅ reprocess 与处理中任务并发时返回 409
- ✅ 进程重启后 `PROCESSING` 卡死文档自动恢复

---

## 📝 Phase A 实施计划

### 步骤 1: 安装依赖

```bash
cd backend
pnpm add bullmq
```

### 步骤 2: 创建队列服务

**新建** `backend/src/modules/knowledge/knowledge-queue.service.ts`

关键逻辑：
- 封装 `Queue<{ documentId: string }>('knowledge-processing')`
- 封装 `Worker` 配置 `concurrency: 2`
- 实现启动时恢复卡死任务的逻辑
- 实现 job 失败重试策略

### 步骤 3: 修改上传流程

**修改** `backend/src/modules/knowledge/document.service.ts`

变更：
```typescript
// 旧代码
this.processor.processDocument(id).catch(err => { ... });

// 新代码
await this.queueService.addDocumentJob(id);
```

### 步骤 4: 修改处理器为 Worker Handler

**修改** `backend/src/modules/knowledge/document-processor.service.ts`

变更：
- `processDocument` 保持原有逻辑
- Worker 在 `knowledge-queue.service.ts` 中调用 `processor.processDocument`

### 步骤 5: 实现状态守卫

**修改** `backend/src/modules/knowledge/document-processor.service.ts`

在 `reprocessDocument` 方法开头增加：
```typescript
// 仅 READY / FAILED 可重处理
const updated = await this.prisma.knowledgeDocument.updateMany({
  where: { 
    id, 
    status: { in: [DocumentStatus.READY, DocumentStatus.FAILED] } 
  },
  data: { status: DocumentStatus.PROCESSING }
});

if (updated.count === 0) {
  throw new ConflictException('文档正在处理中或不存在');
}
```

### 步骤 6: 注册服务

**修改** `backend/src/modules/knowledge/knowledge.module.ts`

```typescript
providers: [
  // ... 现有 providers
  KnowledgeQueueService,
],
```

### 步骤 7: 环境变量检查

确认 `backend/.env` 已有 Redis 配置：
```bash
REDIS_URL="redis://localhost:6379"
```

### 步骤 8: 编写压测脚本

**新建** `backend/scripts/load-test-knowledge.ts`

功能：
- 并发上传 20 份样本文档（混合 pdf/txt）
- 轮询 `documents/status` 直到全部终态
- 统计：成功率、平均处理耗时、P95 耗时、检索延迟

### 步骤 9: 运行验收测试

```bash
# 1. 启动 Redis
docker-compose up -d redis

# 2. 启动 backend
pnpm dev:backend

# 3. 运行压测
tsx backend/scripts/load-test-knowledge.ts

# 4. 验证指标
# - 全部文档处理成功
# - 无 500 错误
# - 检索延迟 200-500ms

# 5. 测试进程重启恢复
# Ctrl+C 停止 backend（留几个文档在 PROCESSING）
# pnpm dev:backend 重启
# 确认卡死文档自动恢复处理

# 6. 测试并发 reprocess
# 对同一个 PROCESSING 文档调用 reprocess
# 预期：返回 409 Conflict
```

---

## 📚 相关文档

| 文档 | 路径 |
|------|------|
| 知识库生产化计划 | `docs/plans/2026-08-17-knowledge-production-plan.md` |
| Phase B 完成报告 | `docs/plans/2026-08-18-phase-b-completion-report.md` |
| Phase B 总结 | `docs/plans/PHASE_B_SUMMARY.md` |
| Embedding 部署指南 | `docs/deployment/embedding-service.md` |
| 最近 Git 提交 | `git log --oneline -5` |

---

## 🔄 后续任务（Phase A 完成后）

### Phase C1: 图片 OCR
- 安装 `tesseract.js`（中文包 chi_sim）
- 修改 `document-parser.service.ts` 增加图片解析分支
- MIME 白名单增加 `image/png`, `image/jpeg`

### Phase C2: 音视频暂缓说明
- 在 `PRD-knowledge-base.md` §10 补充音视频转写依赖说明

### Phase B3: 可用性监控（低优先级）
- `GET /knowledge-test/analytics` 增加 `embeddingAvailable` 字段
- 文档处理降级时记录日志

---

## ✅ 验收标准总结

### Phase A 必须通过
- [ ] 20 并发上传全部进入队列并成功处理
- [ ] 无 500 错误、无 OOM
- [ ] 检索延迟 200-500ms
- [ ] reprocess 与处理中任务并发时返回 409
- [ ] 进程重启后 `PROCESSING` 卡死文档自动恢复

### Phase B 已通过 ✅
- [x] docker-compose 配置生产环境 Embedding 服务
- [x] 环境变量规范化（开发/生产配置清晰）
- [x] 部署文档完整

### Phase C 待验证
- [ ] 上传含中文文字的截图/扫描件，可检索到其中内容
- [ ] 无文字图片返回明确失败原因

---

**当前状态**：Phase B ✅ 完成，准备开始 Phase A（并发加固）  
**下一步行动**：实施 Phase A1 - 创建 `knowledge-queue.service.ts`  
**预计耗时**：Phase A 预计 2-3 小时（含测试）
