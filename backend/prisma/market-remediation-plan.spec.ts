import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { AuditEmployee, buildMarketRemediationPlan } from './market-remediation-plan';

const load = (): AuditEmployee[] => JSON.parse(readFileSync(resolve(__dirname,
  '../../outputs/market-audit-2026-10-15/employees.json'), 'utf8')).employees;

describe('已授权市场整改计划', () => {
  it('保留107位分类，不将任何入口视为已通过或自动归档', () => {
    const employees = load();
    const plan = buildMarketRemediationPlan(employees);
    expect(plan.counts).toEqual({ KEEP: 62, FIX: 5, MERGE: 40, PAUSE: 0 });
    expect(plan.targets.flatMap(group => group.sources)).toHaveLength(40);
    expect(plan.revisions).toHaveLength(6);
    for (const patch of plan.patches.values()) {
      expect(Object.keys(patch).every(key => ['description', 'systemPrompt'].includes(key))).toBe(true);
    }
    for (const source of employees.filter(e => e.actionCode === 'MERGE')) {
      expect(plan.patches.has(source.id)).toBe(false);
    }
  });

  it('为每个合并专项保留原产物、输入和技能路由，重复能力只新增一个绑定', () => {
    const plan = buildMarketRemediationPlan(load());
    const keys = plan.migrations.map(row => `${row.targetId}:${row.capabilityId}`);
    expect(new Set(keys).size).toBe(keys.length);
    for (const { employee, sources } of plan.targets) {
      const prompt = plan.patches.get(employee.id)!.systemPrompt;
      expect(prompt).toContain('不强制调用所有模块');
      for (const source of sources) {
        expect(prompt).toContain(`### ${source.name}`);
        expect(prompt).toContain(source.deliverable.split('\n')[0]);
        expect(prompt).toContain(source.requiredInputs.join('；'));
      }
    }
  });

  it('在目标为另一个合并源、漏技能、错版本或人数变化时阻止执行', () => {
    const mutations: Array<(rows: AuditEmployee[]) => void> = [
      rows => { const sources = rows.filter(e => e.actionCode === 'MERGE'); sources[0].mergePlan[0].targetId = sources[1].id; },
      rows => { rows.find(e => e.mergePlan[0]?.toMigrate.length)!.mergePlan[0].toMigrate.pop(); },
      rows => { rows.find(e => e.mergePlan[0]?.toMigrate.length)!.mergePlan[0].toMigrate[0].versionId = 'wrong'; },
      rows => { const source = rows.find(e => e.mergePlan[0]?.toMigrate.length)!;
        source.evidence = source.evidence.filter(e => e.capabilityId !== source.mergePlan[0].toMigrate[0].capabilityId); },
      rows => { rows[0].actionCode = 'PAUSE'; },
    ];
    for (const mutate of mutations) {
      const rows = load(); mutate(rows);
      expect(() => buildMarketRemediationPlan(rows)).toThrow();
    }
  });
});
