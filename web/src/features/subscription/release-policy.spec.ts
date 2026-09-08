import { describe, expect, it } from 'vitest';
import { getExpectedRefund } from './release-policy';

const base = {
  status: 'ACTIVE' as const,
  startDate: '2026-09-01T00:00:00.000Z',
  employee: { annualPriceCNY: 5000 },
};

describe('getExpectedRefund', () => {
  it('第 7 天仍显示全额退款，并注明进企业钱包', () => {
    expect(getExpectedRefund(base, new Date('2026-09-08T00:00:00.000Z'))).toBe(5000);
  });

  it('超过 7 天不显示退款', () => {
    expect(getExpectedRefund(base, new Date('2026-09-08T00:00:00.001Z'))).toBe(0);
  });

  it('暂停中的雇佣仍按试用期规则计算', () => {
    expect(
      getExpectedRefund(
        { ...base, status: 'PAUSED' },
        new Date('2026-09-02T00:00:00.000Z'),
      ),
    ).toBe(5000);
  });

  it('已终止或没有年费时不显示退款', () => {
    expect(
      getExpectedRefund(
        { ...base, status: 'TERMINATED' },
        new Date('2026-09-02T00:00:00.000Z'),
      ),
    ).toBe(0);
    expect(
      getExpectedRefund(
        { ...base, employee: { annualPriceCNY: null } },
        new Date('2026-09-02T00:00:00.000Z'),
      ),
    ).toBe(0);
  });
});
