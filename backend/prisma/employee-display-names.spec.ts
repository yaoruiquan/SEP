import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  EMPLOYEE_DISPLAY_NAMES, employeeDisplayName, employeeNameAliases,
  historicalEmployeeName, planEmployeeDisplayNames,
} from './employee-display-names';
import { siliconAvatarUrl } from './seed/employee-avatar-map';

describe('Market employee display names', () => {
  const audit = JSON.parse(readFileSync(resolve(__dirname,
    '../../outputs/market-audit-2026-10-15/employees.json'), 'utf8')).employees;

  it('uses short, distinct names and keeps the approved examples', () => {
    const names = Object.values(EMPLOYEE_DISPLAY_NAMES);
    expect(new Set(names).size).toBe(names.length);
    for (const [before, after] of Object.entries(EMPLOYEE_DISPLAY_NAMES)) {
      expect(audit.some(employee => employee.name === before)).toBe(true);
      expect(after.length).toBeLessThanOrEqual(9);
      expect(EMPLOYEE_DISPLAY_NAMES[after]).toBeUndefined();
      expect(employeeDisplayName(after)).toBe(after);
    }
    expect(employeeDisplayName('商品内容与详情页策划')).toBe('商品文案策划');
    expect(employeeDisplayName('电商售后与退货专员')).toBe('售后助手');
    expect(employeeDisplayName('电商单位经济分析师')).toBe('商品利润分析师');
    expect(employeeDisplayName('电商视觉需求策划师')).toBe('商品图片策划');
    expect(employeeDisplayName('电商视频脚本导演')).toBe('商品视频编剧');
  });

  it('preserves all employee IDs and is idempotent for all 107 published employees', () => {
    const changes = planEmployeeDisplayNames(audit);
    expect(changes.length).toBe(Object.keys(EMPLOYEE_DISPLAY_NAMES).length);
    const renamed = audit.map(employee => ({ ...employee, name: employeeDisplayName(employee.name) }));
    expect(renamed.map(employee => employee.id)).toEqual(audit.map(employee => employee.id));
    expect(new Set(renamed.map(employee => employee.name)).size).toBe(107);
    expect(planEmployeeDisplayNames(renamed)).toEqual([]);
  });

  it('does not change archived, draft, unknown or already clear names', () => {
    const rows = [
      { id: 'archived', name: '电商经营日报官', status: 'ARCHIVED' },
      { id: 'draft', name: '电商视频脚本导演', status: 'DRAFT' },
      { id: 'clear', name: '供应商沟通助手', status: 'APPROVED' },
      { id: 'other', name: '自定义员工', status: 'APPROVED' },
    ];
    expect(planEmployeeDisplayNames(rows)).toEqual([]);
    expect(employeeDisplayName('补货计划专员')).toBe('补货计划专员');
    expect(employeeDisplayName('constructor')).toBe('constructor');
  });

  it('rejects conflicting old/new names and duplicate IDs before any write', () => {
    const old = { id: 'one', name: '电商经营日报官', status: 'APPROVED' };
    for (const other of [
      { id: 'two', name: '店铺日报助手', status: 'APPROVED' },
      { id: 'two', name: '店铺日报助手', status: 'ARCHIVED' },
      { id: 'two', name: old.name, status: 'APPROVED' },
      { id: old.id, name: '另一个员工', status: 'APPROVED' },
    ]) expect(() => planEmployeeDisplayNames([old, other])).toThrow();
  });

  it('resolves both names to the same historical identity and avatar', () => {
    for (const [before, after] of Object.entries(EMPLOYEE_DISPLAY_NAMES)) {
      expect(employeeNameAliases(before)).toEqual([before, after]);
      expect(employeeNameAliases(after)).toEqual([before, after]);
      expect(historicalEmployeeName(after)).toBe(before);
      expect(siliconAvatarUrl(after)).toBe(siliconAvatarUrl(before));
    }
    expect(employeeNameAliases('供应商沟通助手')).toEqual(['供应商沟通助手']);
  });
});
