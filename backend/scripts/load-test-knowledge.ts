/**
 * 知识库并发压测脚本（Phase A3）
 *
 * 目标：验证 BullMQ 队列在并发上传下能全部成功处理、无 500 / 卡死，
 *       并统计处理耗时与检索延迟。
 *
 * 运行（在 backend/ 或仓库根目录）：
 *   pnpm --filter backend tsx scripts/load-test-knowledge.ts
 *   或 npx tsx scripts/load-test-knowledge.ts
 *
 * 环境变量：
 *   BASE_URL          后端地址，默认 http://localhost:3001
 *   AUTH_TOKEN        Bearer access token（优先）；缺省则用 LOGIN_EMAIL/LOGIN_PASSWORD 登录
 *   LOGIN_EMAIL       登录邮箱（AUTH_TOKEN 未提供时）
 *   LOGIN_PASSWORD    登录密码
 *   KB_ID             目标知识库 ID；缺省则自动创建一个临时知识库
 *   CONCURRENCY       并发上传数，默认 20
 *
 * 流程：登录 → 准备知识库 → 生成 N 份样本文档（混合 txt/md/pdf）→ 并发上传
 *       → 轮询 documents/status 直到全部终态 → 统计成功率/耗时/P95 → 测检索延迟。
 */

const BASE_URL = process.env.BASE_URL || 'http://localhost:3001';
const CONCURRENCY = parseInt(process.env.CONCURRENCY || '20', 10);
const POLL_INTERVAL_MS = 2000;
const POLL_TIMEOUT_MS = 5 * 60 * 1000; // 最多等 5 分钟

interface StatusSummary {
  total: number;
  pending: number;
  processing: number;
  ready: number;
  failed: number;
  documents: {
    id: string;
    originalName: string;
    status: string;
    lastError: string | null;
    processedAt: string | null;
  }[];
}

// ── 工具 ──────────────────────────────────────────────────────────────────────

function log(msg: string) {
  console.log(`[${new Date().toISOString()}] ${msg}`);
}

async function request(path: string, options: RequestInit = {}) {
  const res = await fetch(`${BASE_URL}${path}`, options);
  const text = await res.text();
  let body: any = null;
  try {
    body = text ? JSON.parse(text) : null;
  } catch {
    body = text;
  }
  if (!res.ok) {
    throw new Error(`${res.status} ${res.statusText}: ${text.slice(0, 500)}`);
  }
  return body;
}

// ── 认证 ──────────────────────────────────────────────────────────────────────

async function resolveToken(): Promise<string> {
  if (process.env.AUTH_TOKEN) {
    return process.env.AUTH_TOKEN;
  }

  const email = process.env.LOGIN_EMAIL;
  const password = process.env.LOGIN_PASSWORD;
  if (!email || !password) {
    throw new Error(
      '缺少认证信息：请设置 AUTH_TOKEN，或同时设置 LOGIN_EMAIL + LOGIN_PASSWORD',
    );
  }

  const res = await fetch(`${BASE_URL}/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password }),
  });
  const body = await res.json();
  if (!res.ok || !body.token) {
    throw new Error(`登录失败: ${JSON.stringify(body)}`);
  }
  log(`已通过 ${email} 登录`);
  return body.token;
}

// ── 知识库 ────────────────────────────────────────────────────────────────────

async function resolveKbId(token: string): Promise<{ kbId: string; created: boolean }> {
  if (process.env.KB_ID) {
    return { kbId: process.env.KB_ID, created: false };
  }

  const kb = await request('/knowledge-bases', {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      name: `load-test-${Date.now()}`,
      description: '并发压测临时知识库',
    }),
  });
  log(`已创建临时知识库 ${kb.id}`);
  return { kbId: kb.id, created: true };
}

// ── 样本文档生成 ──────────────────────────────────────────────────────────────

const CHINESE_PARAGRAPH = [
  '硅基员工平台帮助企业订阅数字员工，通过对话式界面完成客服、数据分析、内容营销等岗位工作。',
  '知识库是数字员工回答企业问题的依据，文档上传后会经过解析、分块、向量化与混合检索。',
  '并发能力是生产化的关键要求，上传过程必须经过队列限流，避免瞬时并发压垮嵌入模型服务。',
  '嵌入模型采用 TEI 独立容器部署，模型为 bge-small-zh-v1.5，输出维度 1024。',
  '检索采用向量与词法双路召回，并通过 RRF 融合排序，兼顾语义匹配与关键词命中。',
].join('\n');

function buildTextContent(seed: number): string {
  const paras = Array.from({ length: 8 }, (_, i) => {
    return `【${seed}】第 ${i + 1} 段。${CHINESE_PARAGRAPH}`;
  });
  return paras.join('\n\n');
}

function buildEnglishContent(seed: number): string {
  const base =
    'The Silicon Employee Platform lets enterprises subscribe to digital employees. ' +
    'Knowledge bases are parsed, chunked, embedded and searched through hybrid retrieval.';
  return Array.from({ length: 10 }, (_, i) => `Seed ${seed} paragraph ${i + 1}. ${base}`).join('\n');
}

/** 生成一个极简但合法的单页 PDF（Helvetica + 纯英文文本），pdf.js 可提取文本。 */
function buildMinimalPdf(text: string): Buffer {
  const esc = text.replace(/\\/g, '\\\\').replace(/\(/g, '\\(').replace(/\)/g, '\\)');
  const stream = `BT\n/F1 12 Tf\n72 720 Td\n(${esc}) Tj\nET`;

  const objects: Record<number, string> = {
    1: '<< /Type /Catalog /Pages 2 0 R >>',
    2: '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    3: '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>',
    4: `<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`,
    5: '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
  };

  let pdf = '%PDF-1.4\n';
  const offsets: number[] = [];
  for (let i = 1; i <= 5; i++) {
    offsets[i] = Buffer.byteLength(pdf, 'latin1');
    pdf += `${i} 0 obj\n${objects[i]}\nendobj\n`;
  }

  const xrefStart = Buffer.byteLength(pdf, 'latin1');
  pdf += 'xref\n0 6\n';
  pdf += '0000000000 65535 f \n';
  for (let i = 1; i <= 5; i++) {
    pdf += `${String(offsets[i]).padStart(10, '0')} 00000 n \n`;
  }
  pdf += `trailer\n<< /Size 6 /Root 1 0 R >>\nstartxref\n${xrefStart}\n%%EOF\n`;

  return Buffer.from(pdf, 'latin1');
}

interface SampleDoc {
  filename: string;
  mimeType: string;
  content: Buffer;
}

function generateSamples(count: number): SampleDoc[] {
  const samples: SampleDoc[] = [];
  for (let i = 0; i < count; i++) {
    const seed = i + 1;
    if (i % 3 === 0) {
      samples.push({
        filename: `sample-${seed}.pdf`,
        mimeType: 'application/pdf',
        content: buildMinimalPdf(buildEnglishContent(seed)),
      });
    } else if (i % 3 === 1) {
      samples.push({
        filename: `sample-${seed}.md`,
        mimeType: 'text/markdown',
        content: Buffer.from(buildTextContent(seed), 'utf-8'),
      });
    } else {
      samples.push({
        filename: `sample-${seed}.txt`,
        mimeType: 'text/plain',
        content: Buffer.from(buildTextContent(seed), 'utf-8'),
      });
    }
  }
  return samples;
}

// ── 上传与轮询 ────────────────────────────────────────────────────────────────

async function uploadOne(token: string, kbId: string, sample: SampleDoc): Promise<number> {
  const start = Date.now();
  const form = new FormData();
  form.append('file', new Blob([sample.content], { type: sample.mimeType }), sample.filename);

  const res = await fetch(`${BASE_URL}/knowledge-bases/${kbId}/documents/upload`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}` },
    body: form,
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`上传 ${sample.filename} 失败: ${res.status} ${text.slice(0, 300)}`);
  }
  return Date.now() - start;
}

async function main() {
  log(`并发压测开始：BASE_URL=${BASE_URL}, CONCURRENCY=${CONCURRENCY}`);

  const token = await resolveToken();
  const { kbId, created } = await resolveKbId(token);
  log(`目标知识库：${kbId}${created ? '（本次自动创建）' : ''}`);

  const samples = generateSamples(CONCURRENCY);
  log(`已生成 ${samples.length} 份样本文档（pdf/txt/md 混合）`);

  // 并发上传（Promise.all，全部同时发起）
  const uploadStart = Date.now();
  const results = await Promise.allSettled(
    samples.map((s) => uploadOne(token, kbId, s)),
  );
  const uploadOk = results.filter((r) => r.status === 'fulfilled');
  const uploadFail = results.filter((r) => r.status === 'rejected');
  log(
    `上传完成：成功 ${uploadOk.length}/${samples.length}，失败 ${uploadFail.length}，耗时 ${Date.now() - uploadStart}ms`,
  );
  uploadFail.forEach((r) => log(`  ✗ ${(r as PromiseRejectedResult).reason?.message}`));

  // 轮询状态直到全部终态
  const startedAt = Date.now();
  let summary: StatusSummary | null = null;

  while (Date.now() - startedAt < POLL_TIMEOUT_MS) {
    await new Promise((r) => setTimeout(r, POLL_INTERVAL_MS));
    summary = await request(`/knowledge-bases/${kbId}/documents/status`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    const terminal = summary.ready + summary.failed;
    log(
      `  状态轮询：total=${summary.total} pending=${summary.pending} processing=${summary.processing} ready=${summary.ready} failed=${summary.failed}`,
    );
    if (summary.total > 0 && terminal >= summary.total) break;
  }

  if (!summary) {
    throw new Error('未能获取文档状态');
  }

  // 收集失败明细
  const failures = summary.documents
    .filter((d) => d.status === 'FAILED')
    .map((d) => `${d.originalName}: ${d.lastError ?? 'unknown'}`);

  // 处理耗时：用 processedAt - 上传开始 近似（同一批几乎同时上传）
  const readyDocs = summary.documents.filter((d) => d.status === 'READY' && d.processedAt);
  const processingDurations = readyDocs.map((d) => {
    const done = new Date(d.processedAt!).getTime();
    const dur = Math.max(done - uploadStart, 0);
    return dur;
  });

  const avgDuration =
    processingDurations.length > 0
      ? processingDurations.reduce((a, b) => a + b, 0) / processingDurations.length
      : 0;
  const sorted = [...processingDurations].sort((a, b) => a - b);
  const p95 =
    sorted.length > 0 ? sorted[Math.floor(sorted.length * 0.95)] ?? sorted[sorted.length - 1] : 0;

  log('\n===== 处理结果 =====');
  log(`总数: ${summary.total}`);
  log(`成功(READY): ${summary.ready}`);
  log(`失败(FAILED): ${summary.failed}`);
  log(`成功率: ${((summary.ready / summary.total) * 100).toFixed(1)}%`);
  log(`平均处理耗时: ${avgDuration.toFixed(0)}ms`);
  log(`P95 处理耗时: ${p95.toFixed(0)}ms`);
  if (failures.length > 0) {
    log(`失败明细:`);
    failures.forEach((f) => log(`  ✗ ${f}`));
  }

  // 检索延迟
  if (summary.ready > 0) {
    try {
      const q = '数字员工如何通过知识库回答企业问题';
      const t0 = Date.now();
      const searchRes = await request(`/knowledge-bases/${kbId}/test-search`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ query: q, topK: 5, strategy: 'auto' }),
      });
      const wall = Date.now() - t0;
      log(`\n===== 检索延迟 =====`);
      log(`服务端耗时: ${searchRes.durationMs ?? 'N/A'}ms`);
      log(`端到端耗时: ${wall}ms`);
      log(`命中数: ${searchRes.hitCount ?? searchRes.results?.length ?? 0}`);
    } catch (e: any) {
      log(`检索测试失败: ${e.message}`);
    }
  }

  const pass = summary.failed === 0 && summary.ready === summary.total;
  log(pass ? '\n✅ 压测通过：全部处理成功，无失败/卡死' : '\n❌ 压测未通过：存在失败文档');

  if (created) {
    log(`提示：临时知识库 ${kbId} 未自动删除，可手动清理。`);
  }

  process.exit(pass ? 0 : 1);
}

main().catch((err) => {
  console.error('\n❌ 压测脚本执行失败:', err?.message ?? err);
  process.exit(1);
});
