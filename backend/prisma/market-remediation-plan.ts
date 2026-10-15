import { createHash } from 'node:crypto';
import { employeePatches, skillPatches } from './market-remediation-content';

export type AuditBinding = {
  id: string; enabled: boolean; capabilityId: string; priority: number;
  defaultSkillVersionId: string | null; effectivePlatformVersionId: string | null;
};
export type AuditEmployee = {
  id: string; name: string; status: string; description: string; systemPrompt: string;
  actionCode: string; deliverable: string; requiredInputs: string[]; acceptance: string;
  bindings: AuditBinding[];
  evidence: Array<{ capabilityId: string; versionId: string; approvedContentSha256: string }>;
  mergePlan: Array<{ targetId: string; target: string; toMigrate: Array<{
    capabilityId: string; name: string; versionId: string;
  }> }>;
};
export const contentHash = (content: string) => createHash('sha256').update(content).digest('hex');

export function buildMarketRemediationPlan(employees: AuditEmployee[]) {
  const counts = { KEEP: 0, FIX: 0, MERGE: 0, PAUSE: 0 };
  const byId = new Map(employees.map(employee => [employee.id, employee]));
  if (byId.size !== employees.length || new Set(employees.map(e => e.name)).size !== employees.length) {
    throw new Error('审计员工 ID 或名称重复');
  }
  for (const employee of employees) {
    if (!Object.prototype.hasOwnProperty.call(counts, employee.actionCode)) throw new Error('未知审计分类');
    counts[employee.actionCode as keyof typeof counts]++;
  }
  if (JSON.stringify(counts) !== JSON.stringify({ KEEP: 62, FIX: 5, MERGE: 40, PAUSE: 0 })) {
    throw new Error('审计分类与已授权的 62/5/40/0 不符');
  }
  const targets = new Map<string, { employee: AuditEmployee; sources: AuditEmployee[] }>();
  const migrations = new Map<string, { sourceId: string; targetId: string; capabilityId: string; versionId: string }>();
  for (const source of employees.filter(employee => employee.actionCode === 'MERGE')) {
    if (!source.mergePlan.length) throw new Error(`合并目标缺失：${source.name}`);
    const seen = new Set<string>();
    for (const merge of source.mergePlan) {
      const target = byId.get(merge.targetId);
      if (!target || !['KEEP', 'FIX'].includes(target.actionCode) || target.name !== merge.target || seen.has(target.id)) {
        throw new Error(`合并目标无效或重复：${source.name}`);
      }
      seen.add(target.id);
      const sourceBindings = source.bindings.filter(binding => binding.enabled);
      const targetIds = new Set(target.bindings.map(binding => binding.capabilityId));
      const missing = sourceBindings.filter(binding => !targetIds.has(binding.capabilityId));
      if (new Set(merge.toMigrate.map(skill => skill.capabilityId)).size !== merge.toMigrate.length ||
          JSON.stringify(missing.map(b => b.capabilityId).sort()) !==
          JSON.stringify(merge.toMigrate.map(skill => skill.capabilityId).sort())) {
        throw new Error(`迁移清单不完整：${source.name}`);
      }
      for (const skill of merge.toMigrate) {
        const binding = missing.find(b => b.capabilityId === skill.capabilityId)!;
        if (binding.effectivePlatformVersionId !== skill.versionId) throw new Error(`迁移版本不符：${source.name}`);
        const evidence = source.evidence.find(item => item.capabilityId === skill.capabilityId);
        if (!evidence || evidence.versionId !== skill.versionId || !/^[a-f0-9]{64}$/.test(evidence.approvedContentSha256)) {
          throw new Error(`迁移内容证据缺失：${source.name}`);
        }
        const key = `${target.id}:${skill.capabilityId}`;
        const prior = migrations.get(key);
        if (prior && prior.versionId !== skill.versionId) throw new Error('相同目标能力存在版本冲突');
        migrations.set(key, { sourceId: source.id, targetId: target.id, capabilityId: skill.capabilityId, versionId: skill.versionId });
      }
      const group = targets.get(target.id) ?? { employee: target, sources: [] };
      group.sources.push(source);
      targets.set(target.id, group);
    }
  }
  const patches = new Map<string, { description?: string; systemPrompt: string }>();
  for (const employee of employees) {
    const patch = employeePatches[employee.name];
    if (patch) patches.set(employee.id, { ...patch, systemPrompt: patch.systemPrompt! });
  }
  for (const { employee, sources } of targets.values()) {
    const base = patches.get(employee.id)?.systemPrompt ?? employee.systemPrompt;
    const modules = sources.map(source => {
      const skills = source.bindings.filter(b => b.enabled).map(b => b.capabilityId).join('、');
      return `### ${source.name}\n- 专项交付：${source.deliverable.split('\n')[0]}\n- 必要输入：${source.requiredInputs.join('；')}\n- 使用已绑定能力：${skills}`;
    }).join('\n\n');
    patches.set(employee.id, { ...patches.get(employee.id), systemPrompt: `${base}\n\n## 合并专项能力\n用户提出以下专项任务时保留其独立产物和数据口径，按任务选择对应技能，不强制调用所有模块。不能因合并扩大执行权限；缺少资料先列缺口，仍只交付待审核产物。\n\n${modules}\n` });
  }
  const revisions = Object.entries(skillPatches).map(([capabilityId, patch]) => {
    const evidence = employees.flatMap(employee => employee.evidence).filter(item => item.capabilityId === capabilityId);
    const expected = evidence[0];
    if (!expected || evidence.some(item => item.versionId !== expected.versionId || item.approvedContentSha256 !== expected.approvedContentSha256)) {
      throw new Error(`修订来源证据缺失或冲突：${capabilityId}`);
    }
    return { capabilityId, ...patch, expectedPlatformVersionId: expected.versionId, expectedContentSha256: expected.approvedContentSha256 };
  });
  return { counts, revisions, patches, migrations: [...migrations.values()], targets: [...targets.values()] };
}
