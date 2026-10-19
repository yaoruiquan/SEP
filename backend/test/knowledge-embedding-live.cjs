'use strict';
/* eslint-disable @typescript-eslint/no-require-imports -- Register the CommonJS ts-node hook before loading Nest TypeScript services. */

// Loopback-only, synthetic text, no database and no application bootstrap.
const assert = require('node:assert/strict');
const path = require('node:path');
const { mkdirSync, writeFileSync } = require('node:fs');
const { parseArgs } = require('node:util');
const { values } = parseArgs({ options: { 'base-url': { type: 'string' }, output: { type: 'string' } } });
const root = path.resolve(__dirname, '../..');
process.env.TS_NODE_PROJECT = path.join(root, 'backend/tsconfig.json');
require('reflect-metadata');
require('ts-node/register/transpile-only');
const { ConfigModule, ConfigService } = require('@nestjs/config');
const { EmbeddingService } = require('../src/modules/knowledge/embedding.service');
const { TextChunker } = require('../src/modules/knowledge/text-chunker.util');

async function main() {
  await ConfigModule.forRoot({ envFilePath: [path.join(root, '.env'), path.join(root, 'backend/.env')] });
  const config = new ConfigService();
  assert.equal(config.get('EMBEDDING_PROVIDER'), 'ollama', 'Live smoke never uses the paid relay');
  const base = new URL(values['base-url'] || config.get('EMBEDDING_BASE_URL'));
  assert.ok(['127.0.0.1', 'localhost', '[::1]'].includes(base.hostname), 'Live smoke permits loopback only');
  assert.equal(base.protocol, 'http:');
  assert.ok(!base.username && !base.password && !base.search && !base.hash);
  const service = new EmbeddingService({
    get: key => key === 'EMBEDDING_BASE_URL' ? base.toString() : config.get(key),
  });
  await service.onModuleInit();
  const documents = [
    '财务制度：员工出差的交通和住宿费用，凭发票在财务系统申请报销，审批后打款。',
    '账号指南：忘记登录密码时，在登录页面选择找回密码，通过注册邮箱验证码重设密码。',
    '考勤制度：员工因病无法上班，需要在考勤系统提交病假申请并附医院证明，直属主管审批。',
    '接口规范：每个成员每分钟最多检索六十次，超过限制返回429，按Retry-After提示稍后重试。',
    '知识管理：替换后的旧文档默认保留三十天，到期清理正文和原件，保留版本元数据。',
    '客户开票：企业客户付款后可提交公司抬头、纳税人识别号和收件邮箱，申请增值税发票。',
  ];
  const queries = [
    '出差住酒店花的钱怎样报销？', '登录口令忘了，怎么恢复账号？',
    '生病去不了公司，应当怎么办请假？', '搜索太频繁被限制了应该等多久？',
    '被替换的历史资料过多久会删除？', '购买服务之后如何申请公司发票？',
  ];
  const started = Date.now();
  const vectors = await service.embedBatch([...documents, ...queries]);
  const cosine = (a, b) => {
    let dot = 0, normA = 0, normB = 0;
    for (let i = 0; i < a.length; i++) { dot += a[i] * b[i]; normA += a[i] ** 2; normB += b[i] ** 2; }
    return dot / Math.sqrt(normA * normB);
  };
  const rankings = queries.map((_, index) => {
    const scores = documents.map((__, doc) => ({ doc, score: cosine(vectors[documents.length + index].embedding, vectors[doc].embedding) }))
      .sort((a, b) => b.score - a.score);
    return { query: index, expected: index, top3: scores.slice(0, 3).map(item => item.doc) };
  });
  const model = service.getModel();
  const counts = [];
  for (const text of ['测试知识库向量化', 'Hello world', '企业员工报销流程是什么？', '<mask>', '  hello\n\nworld  ', '你好，ＡＢＣ 123 ① é e\u0301 👩🏽‍💻']) {
    const response = await fetch(new URL('/api/embed', base), {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      signal: AbortSignal.timeout(120_000), body: JSON.stringify({ model, input: text, truncate: false }),
    });
    assert.ok(response.ok, 'Native token comparison must succeed');
    const payload = await response.json();
    counts.push({ text, local: TextChunker.countTokens(text), native: payload.prompt_eval_count });
  }
  await assert.rejects(service.embed('hello '.repeat(10_000)), /HTTP 400/, 'Oversized input must fail, never silently truncate');
  const report = {
    profile: service.getProfile(), dimension: vectors[0].embedding.length,
    syntheticDocuments: documents.length, syntheticQueries: queries.length,
    top1: rankings.filter(item => item.top3[0] === item.expected).length,
    top3: rankings.filter(item => item.top3.includes(item.expected)).length,
    rankings, counts, tokenizerExactlyMatchesNativeOnAllSamples: counts.every(item => item.local === item.native),
    oversizedInputRejected: true, durationMs: Date.now() - started,
    scope: 'Loopback real Ollama and tokenizer only; not DB, permissions, client integration or production retrieval acceptance',
  };
  assert.equal(report.dimension, 1024);
  assert.equal(report.top3, queries.length, 'Synthetic semantic smoke must retrieve each expected document in Top3');
  if (values.output) {
    const target = path.resolve(values.output);
    mkdirSync(path.dirname(target), { recursive: true });
    writeFileSync(target, JSON.stringify(report, null, 2) + '\n', { mode: 0o600 });
  }
  console.log(JSON.stringify(report, null, 2));
}

main().catch(error => {
  console.error(JSON.stringify({ status: 'failed', type: error?.constructor?.name,
    reason: error?.code === 'ERR_ASSERTION' ? error.message : 'Local embedding smoke failed; check Ollama and tokenizer configuration' }));
  process.exitCode = 1;
});
