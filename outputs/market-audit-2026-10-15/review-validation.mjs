import assert from 'node:assert/strict';

export const actionLabels = {
  KEEP: '保留候选，限定交付范围后验收',
  FIX: '修复后保留，重新验收',
  MERGE: '建议收起独立入口，合并能力',
  PAUSE: '建议暂时下架，补齐后重评',
};

export function validateReviews(snapshot, reviews) {
  assert.equal(reviews.length, snapshot.employees.length, '员工数量不完整');
  assert.equal(new Set(reviews.map(review => review.id)).size, reviews.length, '员工重复');
  const byId = new Map(reviews.map(review => [review.id, review]));
  const byName = new Map(reviews.map(review => [review.name, review]));
  for (const employee of snapshot.employees) {
    const review = byId.get(employee.id);
    assert.ok(review, `遗漏员工: ${employee.id}`);
    assert.equal(review.name, employee.name, '员工身份不匹配');
    assert.ok(Object.hasOwn(actionLabels, review.actionCode), `非法建议: ${employee.name}`);
    assert.ok(['DIRECT', 'GENERAL_TRANSFER', 'NEEDS_ADAPTATION'].includes(review.domesticFit));
    for (const field of ['deliverable', 'reason', 'acceptance']) {
      assert.ok(typeof review[field] === 'string' && review[field].trim(), `${employee.name} 缺 ${field}`);
    }
    for (const field of ['requiredInputs', 'dependencies', 'evidence']) assert.ok(Array.isArray(review[field]));
    assert.ok(review.requiredInputs.length, `${employee.name} 未列输入`);
    const bindings = employee.bindings.filter(binding => binding.enabled);
    for (const binding of bindings) {
      const evidence = review.evidence.filter(item => item.capabilityId === binding.capabilityId);
      assert.ok(evidence.length, `${employee.name} 缺技能证据: ${binding.capabilityName}`);
      for (const item of evidence) {
        assert.equal(item.versionId, binding.effectivePlatformVersionId, `${employee.name} 引用了非生效版本`);
        const capability = snapshot.capabilities.find(item => item.id === binding.capabilityId);
        const version = capability?.versions.find(version => version.id === item.versionId);
        assert.ok(version && item.quote?.trim() && version.content.includes(item.quote), `${employee.name} 摘录非正文原文`);
      }
    }
    assert.ok(review.evidence.every(item => bindings.some(binding => binding.capabilityId === item.capabilityId)),
      `${employee.name} 引用了未绑定技能`);
    if (review.actionCode === 'MERGE') {
      assert.ok(typeof review.target === 'string' && review.target.trim(), `${employee.name} 缺合并目标`);
      const targets = review.target.split('/').map(name => name.trim());
      for (const name of targets) {
        const target = byName.get(name);
        assert.ok(target && ['KEEP', 'FIX'].includes(target.actionCode), `${employee.name} 目标不是保留候选: ${name}`);
        assert.notEqual(name, employee.name, '不能合并到自己');
      }
    }
  }
  return true;
}
