import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { validateReviews } from './review-validation.mjs';

const read = file => JSON.parse(readFileSync(new URL(file, import.meta.url), 'utf8'));
const snapshot = read('./snapshot.json');
const reviews = read('./employees.json').employees;
const verification = read('./verification.json');
const hash = value => createHash('sha256').update(value).digest('hex');

test('每位员工都有逐绑定原文证据、可交付物及无环合并目标', () => {
  assert.equal(validateReviews(snapshot, reviews), true);
});
test('遗漏、重复及伪造引文必须被拒绝', () => {
  assert.throws(() => validateReviews(snapshot, reviews.slice(1)), /数量/);
  assert.throws(() => validateReviews(snapshot, [...reviews.slice(1), reviews[1]]), /重复/);
  const altered = structuredClone(reviews);
  altered[0].evidence[0].quote = 'not-a-real-skill-quotation-20261015';
  assert.throws(() => validateReviews(snapshot, altered), /原文/);
});
test('错误生效版本与遗漏协同技能不能混入结果', () => {
  const altered = structuredClone(reviews);
  altered[0].evidence[0].versionId = 'not-current';
  assert.throws(() => validateReviews(snapshot, altered), /非生效版本/);
  const missing = structuredClone(reviews);
  missing[0].evidence = [];
  assert.throws(() => validateReviews(snapshot, missing), /缺技能证据/);
});
test('合并目标必须是保留或待修复的实际候选', () => {
  const altered = structuredClone(reviews);
  const row = altered.find(row => row.actionCode === 'MERGE');
  assert.ok(row);
  row.target = row.name;
  assert.throws(() => validateReviews(snapshot, altered), /目标|自己/);
});
test('全部正式制品文件与批准正文的字节、哈希及长度一致', () => {
  for (const capability of snapshot.capabilities) {
    for (const version of capability.versions) {
      const descriptor = version.descriptor;
      const bytes = readFileSync(new URL(version.artifactFile, import.meta.url));
      assert.equal(hash(version.content), version.contentSha256);
      assert.equal(hash(version.content), descriptor.approvedContentSha256);
      assert.equal(hash(bytes), descriptor.artifactSha256);
      assert.equal(bytes.length, descriptor.byteLength);
      assert.equal(descriptor.status, 'AVAILABLE');
    }
  }
  assert.equal(verification.passed, snapshot.capabilities.reduce((count, capability) => count + capability.versions.length, 0));
});
test('历史4任务8技能核对不扩大为全员业务PASS', () => {
  const tested = reviews.filter(row => row.businessStatus !== 'UNTESTED');
  assert.equal(tested.length, 4);
  assert.equal(tested.filter(row => row.businessStatus === 'FAIL').length, 2);
  assert.equal(tested.filter(row => row.businessStatus === 'CONDITIONAL').length, 2);
  assert.equal(reviews.filter(row => row.businessStatus === 'PASS').length, 0);
  assert.equal(verification.historicalRuntime.currentEntryHashesMatched, 8);
  for (const row of reviews) {
    if (row.businessStatus === 'FAIL') assert.equal(row.actionCode, 'FIX');
  }
});
test('公开市场ID、身份、描述及订阅数与只读快照一致', () => {
  const report = read('./public-market-check.json');
  assert.equal(report.allMatched, true);
  assert.equal(report.count, snapshot.total);
  assert.deepEqual(report.employees.map(employee => employee.id).sort(), snapshot.employees.map(employee => employee.id).sort());
});
test('合并清单明确区分已共享绑定和仍需迁移的正式技能', () => {
  for (const row of reviews.filter(row => row.actionCode === 'MERGE')) {
    assert.ok(row.mergePlan.length);
    for (const plan of row.mergePlan) {
      assert.equal(plan.status, 'PROPOSED_ONLY');
      const target = reviews.find(candidate => candidate.id === plan.targetId);
      assert.ok(target && ['KEEP', 'FIX'].includes(target.actionCode));
      const targetIds = new Set(target.bindings.filter(binding => binding.enabled).map(binding => binding.capabilityId));
      const missing = row.bindings.filter(binding => binding.enabled && !targetIds.has(binding.capabilityId));
      assert.deepEqual(plan.toMigrate.map(skill => skill.capabilityId).sort(), missing.map(binding => binding.capabilityId).sort());
      for (const skill of plan.toMigrate) {
        assert.equal(skill.versionId, missing.find(binding => binding.capabilityId === skill.capabilityId).effectivePlatformVersionId);
      }
    }
  }
});
test('正式报告所有员工链接与本地证据路径均可定位', () => {
  const reportUrl = new URL('../../docs/progress/2026-10-15-国内电商市场员工逐一核查与取舍清单.md', import.meta.url);
  const report = readFileSync(reportUrl, 'utf8');
  for (const row of reviews) {
    assert.ok(report.includes(`[${row.name}](../../outputs/market-audit-2026-10-15/逐员工证据.md#${row.anchor})`));
  }
  for (const match of report.matchAll(/\]\(([^)\n]+)\)/g)) {
    if (/^https?:/.test(match[1])) continue;
    const target = new URL(match[1], reportUrl);
    const fragment = target.hash.slice(1);
    target.hash = '';
    assert.ok(existsSync(target), `报告链接不存在: ${match[1]}`);
    if (fragment) assert.ok(readFileSync(target, 'utf8').includes(`<a id="${fragment}"></a>`), `证据锚点不存在: ${fragment}`);
  }
});
test('证据清单哈希与最终文件一致，CSV逐位覆盖', () => {
  for (const entry of read('./evidence-manifest.json').files) {
    const bytes = readFileSync(new URL(entry.path, import.meta.url));
    assert.equal(hash(bytes), entry.sha256, entry.path);
    assert.equal(bytes.length, entry.byteLength, entry.path);
  }
  const csv = readFileSync(new URL('./employees.csv', import.meta.url), 'utf8');
  assert.ok(csv.startsWith('\ufeff'));
  for (const row of reviews) assert.equal(csv.split(`"${row.id}"`).length - 1, 1, row.name);
});
