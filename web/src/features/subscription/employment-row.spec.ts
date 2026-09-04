import { describe, expect, it } from 'vitest';
import {
  buildEmploymentRow,
  describeGrantShape,
  summarizeAttention,
} from './employment-row';
import type { MyEmployeeUsage, Subscription } from '@/lib/types';

function usage(overrides: Partial<MyEmployeeUsage> = {}): MyEmployeeUsage {
  return {
    activeUserCount30d: 2,
    grantedUserCount: 4,
    grantedDepartmentCount: 2,
    grantedMemberCount: 0,
    lastUsedAt: '2026-09-01T00:00:00.000Z',
    monthCostCNY: '1.20',
    monthCallCount: 8,
    executionCount30d: 10,
    successRate30d: 90,
    ...overrides,
  };
}

/** 固定「现在」，否则宽限期用例会随真实日期漂移 */
const NOW = new Date('2026-09-04T00:00:00.000Z').getTime();
/** 早于宽限期（14 天）之前雇的，才该被指控「雇了没人用」 */
const LONG_AGO = '2026-08-01T00:00:00.000Z';
const JUST_HIRED = '2026-09-01T00:00:00.000Z';

function sub(overrides: Partial<Subscription> = {}): Subscription {
  return {
    id: 'sub-1',
    name: '会议纪要专家',
    status: 'ACTIVE',
    templateVersion: '1.0.0',
    latestVersion: '1.0.0',
    upgradeAvailable: false,
    config: null,
    startDate: LONG_AGO,
    endDate: null,
    createdAt: '2026-08-01T00:00:00.000Z',
    updatedAt: '2026-08-01T00:00:00.000Z',
    employee: {
      id: 'emp-1',
      name: '会议纪要专家',
      description: '',
      avatar: null,
      industry: '通用',
      position: '文字处理',
      functionalCategory: 'OPERATIONS_ORG',
      status: 'APPROVED',
      version: '1.0.0',
    },
    giftGrantedCNY: '20.00',
    giftUsedCNY: '2.00',
    giftRemainingCNY: '18.00',
    giftStatus: 'ACTIVE',
    usage: usage(),
    ...overrides,
  };
}

describe('buildEmploymentRow', () => {
  it('reports nothing for a healthy employment', () => {
    const row = buildEmploymentRow(sub(), NOW);
    expect(row.attention).toEqual([]);
    expect(row.primaryAttention).toBeNull();
    expect(row.dismissed).toBe(false);
  });

  it('flags an employment nobody was granted — 花了钱一个人也用不上', () => {
    const row = buildEmploymentRow(
      sub({ usage: usage({ grantedUserCount: 0, grantedDepartmentCount: 0, activeUserCount30d: 0 }) }),
      NOW,
    );
    // 没授权就不该再报一次「没人用」：同一件事说两遍
    expect(row.attention).toEqual(['NO_GRANT']);
  });

  it('flags granted-but-unused separately from never-granted', () => {
    const row = buildEmploymentRow(sub({ usage: usage({ activeUserCount30d: 0 }) }), NOW);
    expect(row.attention).toEqual(['UNUSED']);
  });

  it('gives a freshly hired employment a grace period before calling it unused', () => {
    // 只雇了 3 天就报「近 30 天没人用」是无意义的指控 —— 分母还没长够。
    // 演示租户 19 段雇佣里 16 段都是 7 天前建的，不设宽限期这一栏会盖掉真正的问题。
    const row = buildEmploymentRow(
      sub({ startDate: JUST_HIRED, usage: usage({ activeUserCount30d: 0 }) }),
      NOW,
    );
    expect(row.attention).toEqual([]);
  });

  it('orders multiple problems by severity and picks the worst as primary', () => {
    const row = buildEmploymentRow(
      sub({
        status: 'PAUSED',
        upgradeAvailable: true,
        giftStatus: 'EXHAUSTED',
        usage: usage({ grantedUserCount: 0, grantedDepartmentCount: 0, activeUserCount30d: 0 }),
      }),
      NOW,
    );
    expect(row.attention).toEqual(['NO_GRANT', 'PAUSED', 'UPGRADABLE', 'GIFT_EXHAUSTED']);
    expect(row.primaryAttention).toBe('NO_GRANT');
  });

  it('stays silent when usage has not been aggregated — 不知道不等于没授权', () => {
    const row = buildEmploymentRow(sub({ usage: undefined }), NOW);
    expect(row.attention).toEqual([]);
  });

  it('raises no todos for a dismissed employment', () => {
    const row = buildEmploymentRow(
      sub({
        status: 'EXPIRED',
        upgradeAvailable: true,
        usage: usage({ grantedUserCount: 0, grantedDepartmentCount: 0, activeUserCount30d: 0 }),
      }),
      NOW,
    );
    expect(row.dismissed).toBe(true);
    expect(row.attention).toEqual([]);
  });
});

describe('summarizeAttention', () => {
  it('counts every row carrying a problem, not just the ones where it is the worst', () => {
    const rows = [
      // 既没授权又可升级：两栏都要数到，否则点「1 个可升级」会看到空列表
      buildEmploymentRow(
        sub({
          upgradeAvailable: true,
          usage: usage({ grantedUserCount: 0, grantedDepartmentCount: 0, activeUserCount30d: 0 }),
        }),
        NOW,
      ),
      buildEmploymentRow(sub({ id: 'sub-2', upgradeAvailable: true }), NOW),
      buildEmploymentRow(sub({ id: 'sub-3' }), NOW),
    ];

    expect(summarizeAttention(rows)).toEqual([
      { meta: expect.objectContaining({ kind: 'NO_GRANT' }), count: 1 },
      { meta: expect.objectContaining({ kind: 'UPGRADABLE' }), count: 2 },
    ]);
  });

  it('returns an empty summary when nothing needs attention', () => {
    expect(summarizeAttention([buildEmploymentRow(sub(), NOW)])).toEqual([]);
  });
});

describe('describeGrantShape', () => {
  it('distinguishes department grants from individual ones', () => {
    expect(describeGrantShape(sub())).toBe('2 个部门');
    expect(
      describeGrantShape(sub({ usage: usage({ grantedDepartmentCount: 1, grantedMemberCount: 3 }) })),
    ).toBe('1 个部门 · 3 人单独');
    expect(
      describeGrantShape(
        sub({ usage: usage({ grantedUserCount: 0, grantedDepartmentCount: 0, grantedMemberCount: 0 }) }),
      ),
    ).toBe('未授权');
  });

  it('shows a dash rather than 未授权 when usage is missing', () => {
    expect(describeGrantShape(sub({ usage: undefined }))).toBe('—');
  });
});
