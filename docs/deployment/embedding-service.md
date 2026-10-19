# Embedding 服务部署指南

2026-10-19 按用户确认修正：**生成模型继续经 sub2api；知识库 embedding 使用独立的内网 Ollama，不经 sub2api**。选择 BGE-M3 FP16，固定模型摘要与 tokenizer 文件；PostgreSQL 使用 pgvector 保存 1024 维向量并执行 HNSW 余弦检索。

## 1. 架构与边界

```text
SEP backend  --HTTP-->  Ollama :11434/api/tags + /api/embed
       |
       +---------------> PostgreSQL pgvector (vector(1024), HNSW)
```

Ollama 是独立服务，可以与 SEP 部署在同一台服务器或独立机器。不要在生产环境依赖后端容器内的 `localhost`，也不要把大模型中转服务当作 Embedding 服务。

## 2. 模型版本与部署建议

本阶段推荐 `bge-m3:567m-fp16`：多语言模型，与当前 1024 维数据库兼容，避免先换模型再返工索引。2026-10-19 官方仓库中 `latest`、`567m`、`567m-fp16` 对应同一个约 1.2 GB 的模型包，但这些标签本身都不是不可变版本。

本次实际核实的发布基线：

| 项目 | 固定值 |
| --- | --- |
| Ollama 模型 manifest SHA-256 | `7907646426070047a77226ac3e684fbbe8410524f7b4a74d02837e43f2146bab` |
| GGUF 权重 blob SHA-256 | `daec91ffb5dd0c27411bd71f29932917c49cf529a641d0168496c3a501e3062c` |
| 本地发布别名 | `bge-m3:sep-790764642607` |
| 原生输出 | 1024 维，cosine |
| tokenizer 来源 | `BAAI/bge-m3@5617a9f61b028005a4858fdac845db406aefb181` |
| 本次本地测试运行时 | Ollama `0.33.1`，不是对所有环境的版本要求 |

小规模可以与平台同机，但 Ollama 独立进程/容器、限制并发并使用持久模型卷。生产只允许后端在内网访问，不把无鉴权的 11434 端口公开到互联网；Docker 同网络访问无需向公网映射端口。公司原件/文本仍上传平台，本部署不等于企业数据只留在客户端。

硬件选型先以现有机器实测为准。本地 Apple M4/16 GB 已能运行本模型；Linux 小规模试点可先按 4 核/8 GB **独立服务预算**、batch=8、并发=1 试跑，不能把这个数当成整个平台的生产容量承诺。没有显卡可以试用 CPU，但必须测试长文档吞吐和检索延迟；后续按压力增加内存、GPU 或独立推理节点。容器镜像选择在目标机器验收过的明确版本并固定 digest，不自动追随 `latest`。

## 3. 准备模型

在目标服务器安装 Ollama 后执行：

```bash
ollama pull bge-m3:567m-fp16
```

然后在本机检查完整摘要，**不匹配则停止，不要直接复制一个旧名字继续上线**：

```bash
curl http://127.0.0.1:11434/api/tags
```

确认 `bge-m3:567m-fp16` 的 `digest` 与上表一致后执行：

```bash
ollama cp bge-m3:567m-fp16 bge-m3:sep-790764642607
```

本次本机已缓存的 `bge-m3:latest` 与上述 manifest 一致，因此直接从缓存复制了发布别名，没有重新拉取权重。不要覆盖/更新正在提供服务的发布别名；新版使用新的摘要和别名。应用每次 embedding 请求前检查 `/api/tags`，摘要不符则拒绝请求，不回退到 sub2api。这个检查是漂移检测，不是对拥有 Ollama 管理权限者的安全隔离，也不能替代发布期间禁止改写别名的约束。

## 4. 准备 tokenizer

在仓库根目录执行：

```bash
node scripts/prepare-knowledge-tokenizer.mjs
node scripts/prepare-knowledge-tokenizer.mjs --check
```

脚本只下载固定 Hugging Face commit 下的 `tokenizer.json` 和 `tokenizer_config.json`，检查预先记录的 SHA-256 与 JSON 格式，不下载模型权重。默认保存到 `.cache/tokenizers/bge-m3/5617a9f61b028005a4858fdac845db406aefb181/`，不提交 Git；重复执行会复用已校验的文件。需要联网仅发生在准备阶段，后端运行时只读本地文件。

生产先在服务器准备宿主机目录：

```bash
node scripts/prepare-knowledge-tokenizer.mjs --root /opt/sep/tokenizers
```

Compose 通过 `KNOWLEDGE_TOKENIZERS_HOST_PATH=/opt/sep/tokenizers` 只读挂载到 `/app/tokenizers`，API/worker 使用同一版本，不能把 Mac 的绝对路径填进 Linux 容器。

新版本原件通过 `KNOWLEDGE_PRIVATE_HOST_PATH=/opt/sep/knowledge` 共享挂载到 `/app/private/knowledge`，目录必须事先创建并设置为容器 `node` 用户可写、0700；生产/dev 使用不同目录。这个路径不能挂到公开静态服务。保留旧 uploads 卷，旧原件不迁移或删除。若旧容器已在私有临时目录产生原件，先停知识库写入并备份、复制、核对引用和文件，再切换共享挂载，不能用空目录遮住已有原件。

**已知兼容边界：**固定来源文件不等于两种推理实现对任意字符都会产生完全相同的 token 数。本次发现官方 HF tokenizer 与 Ollama GGUF 的普通中文样例计数一致，但 `<mask>`、连续空白和部分 Unicode 不一致；250002 个词表项中最后一项是 HF `<mask>` 与 GGUF `[PAD250000]` 的差别，现有 Transformers.js 对预编译规范化也有实现限制。不要手改官方文件冒充完全匹配。当前本地 tokenizer 作为平台切片/预算口径；原生 `/api/embed` 强制 `truncate=false`，超出模型上下文时明确失败，不悄悄删内容。要承诺与原生逐 token 一致，仍需要采用同一 tokenizer 实现或另行完成原生兼容工作，不能宣称已完成这项验收。

## 5. SEP 环境变量

### 后端与 Ollama 同机、后端直接运行

```dotenv
EMBEDDING_PROVIDER=ollama
EMBEDDING_BASE_URL=http://127.0.0.1:11434
EMBEDDING_MODEL=bge-m3:sep-790764642607
EMBEDDING_MODEL_DIGEST=sha256:7907646426070047a77226ac3e684fbbe8410524f7b4a74d02837e43f2146bab
EMBEDDING_TOKENIZER=BAAI/bge-m3@5617a9f61b028005a4858fdac845db406aefb181
EMBEDDING_TOKENIZER_PATH=/实际仓库路径/.cache/tokenizers/bge-m3/5617a9f61b028005a4858fdac845db406aefb181
EMBEDDING_DISTANCE=cosine
EMBEDDING_DIMENSION=1024
EMBEDDING_BATCH_SIZE=8
EMBEDDING_TIMEOUT_MS=120000
```

### 后端容器访问 Ollama

```dotenv
EMBEDDING_PROVIDER=ollama
EMBEDDING_BASE_URL=http://sep-ollama:11434
EMBEDDING_MODEL=bge-m3:sep-790764642607
EMBEDDING_MODEL_DIGEST=sha256:7907646426070047a77226ac3e684fbbe8410524f7b4a74d02837e43f2146bab
EMBEDDING_TOKENIZER=BAAI/bge-m3@5617a9f61b028005a4858fdac845db406aefb181
EMBEDDING_TOKENIZER_PATH=/app/tokenizers/bge-m3/5617a9f61b028005a4858fdac845db406aefb181
KNOWLEDGE_TOKENIZERS_HOST_PATH=/opt/sep/tokenizers
EMBEDDING_DISTANCE=cosine
EMBEDDING_DIMENSION=1024
```

`EMBEDDING_BASE_URL` 兼容旧 `/v1` 后缀，但 `ollama` provider 实际请求原生 `/api/tags`、`/api/embed`，不读取或转发 sub2api 密钥。旧 `EMBEDDING_API_KEY=ollama-local` 不参与原生调用。provider 只接受 `ollama` 或 `sub2api`，旧 `openai` 配置必须迁移，避免误判出口。显式 `sub2api` 保留原中转 embedding 路径；未设置 provider 时也保持该旧路径，但部署模板统一显式使用 `ollama`。

模型名从 `bge-m3:latest` 改为发布别名、或 tokenizer profile 改变后，旧向量不会自动冒充兼容。管理员需要通过当前版本作业重试/重建流程重新发布索引；不要改数据库模型名来绕过校验。当前生产 schema 只支持 1024 维，不要只改环境变量换成其他维度。

## 6. PostgreSQL 与迁移

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

## 7. 发布验收

1. `/api/tags` 的发布别名与完整摘要正确，准备脚本 `--check` 通过。
2. `/api/embed` 单条和批量请求均返回 1024 维；`truncate=false`，超长文本返回错误。
3. SEP 能加载本地 tokenizer，无 `TOKENIZER_UNAVAILABLE`；不要依据未实现的启动成功日志判断配置生效。
4. 上传 TXT/Markdown 文档，状态从 `PENDING`/`PROCESSING` 变为 `READY`。
5. 新版本 `TextChunk.embeddingModel` 为发布别名，`embeddingVector` 非空，profile 使用当前 tokenizer 标识。
6. 执行向量或混合检索，确认结果受企业和订阅授权过滤。
7. 已有索引通过当前版本作业重新发布，旧内容不能混用；新版失败不删除旧生效版。

本地无数据库、无真实企业资料的复验：

```bash
node backend/test/knowledge-embedding-live.cjs
```

脚本只允许 loopback Ollama，使用合成语料，输出语义 Top1/Top3、token 计数差异及超限拒绝结果，不会调用付费中转、迁移数据库或重建企业索引。这不是权限/来源/客户端/业务黄金集完整验收。

## 8. 故障排查

### 当前本地开发环境

如果 `curl http://127.0.0.1:11434/api/tags` 返回 connection refused，说明 Ollama 没有运行，
不是知识库文本解析问题。启动 Ollama 后加载模型：

```bash
ollama serve
```

保持该终端运行，在另一个终端检查：

```bash
ollama list
node scripts/prepare-knowledge-tokenizer.mjs --check
```

另开终端验证维度：

```bash
curl -sS -X POST http://127.0.0.1:11434/api/embed \
  -H 'Content-Type: application/json' \
  -d '{"model":"bge-m3:sep-790764642607","input":"测试知识库向量化","truncate":false}' \
  | node -e "let s='';process.stdin.on('data',d=>s+=d).on('end',()=>{const v=JSON.parse(s).embeddings?.[0]; console.log('embedding dimensions:', v?.length); process.exit(v?.length===1024?0:1)})"
```

验证通过后重启 backend。已有文档通过当前版本流程重试/重新发布。新版本 embedding 失败不会标记 READY；检索时 query embedding 失败才按契约返回词法降级。

### `ECONNREFUSED`

- 检查 Ollama：`curl http://127.0.0.1:11434/api/tags`。
- 后端容器内不要使用 `127.0.0.1`，改用 Docker 网络中的 Ollama 服务名或内网地址。
- 检查防火墙和 Ollama 监听地址。

### 维度不匹配

确保 `EMBEDDING_DIMENSION=1024`，模型别名与摘要符合本次发布基线。不要沿用其他模型的维度；修改 profile 后必须重新发布索引。

### 文档只有词法检索

查看文档处理错误和后端日志，确认 Ollama 可用、摘要正确、tokenizer 可读、pgvector 迁移已执行。检索可返回明确的词法降级；入库 embedding 失败不能伪装成功。

## 9. 相关文档与官方来源

- Ollama BGE-M3 标签及模型包：<https://ollama.com/library/bge-m3/tags>
- Ollama 原生 embedding（含 `truncate`）：<https://docs.ollama.com/api/embed>
- Ollama 本地模型复制：<https://docs.ollama.com/api/copy>
- 固定来源 HF 仓库：<https://huggingface.co/BAAI/bge-m3/tree/5617a9f61b028005a4858fdac845db406aefb181>

- [知识库第二阶段 pgvector + bge-m3 升级方案](../plans/知识库第二阶段-pgvector-bge-m3本地升级.md)
- [生产 Compose](../../deploy/production/docker-compose.yml)
- [知识库设计与技术栈](../对接/SEP知识库设计与技术栈说明.md)
