import { describe, expect, it } from 'vitest';
import type { UsageRecordItem } from '@/lib/api/use-compute-credit';
import {
  CSV_HEADER,
  buildUsageRecordsCsv,
  csvAmount,
  csvCell,
  toCsvRow,
} from './usage-record-csv';

function record(overrides: Partial<UsageRecordItem> = {}): UsageRecordItem {
  return {
    id: 'rec-1',
    createdAt: '2026-09-02T10:15:30.000Z',
    employeeId: 'emp-1',
    employeeName: '市场调研员',
    memberId: 'user-1',
    memberName: '张三',
    sessionId: 'sess-1',
    modelId: 'deepseek-chat',
    inputTokens: 1234,
    outputTokens: 567,
    costCNY: '0.0123',
    creditPaidCNY: '0.0123',
    walletPaidCNY: '0.0000',
    personalPaidCNY: '0.0000',
    unpaidCNY: '0.0000',
    fallbackPricing: false,
    ...overrides,
  };
}

describe('csvCell', () => {
  it('一律加引号，内部引号翻倍', () => {
    expect(csvCell('市场调研员')).toBe('"市场调研员"');
    expect(csvCell('他说"你好"')).toBe('"他说""你好"""');
  });

  it('逗号与换行不会破坏列结构', () => {
    expect(csvCell('研发,市场')).toBe('"研发,市场"');
    expect(csvCell('第一行\n第二行')).toBe('"第一行\n第二行"');
  });

  it('中和 Excel 公式注入 —— 员工名和成员名都是用户可填字段', () => {
    expect(csvCell('=1+1')).toBe('"\'=1+1"');
    expect(csvCell('+SUM(A1)')).toBe('"\'+SUM(A1)"');
    expect(csvCell('@cmd')).toBe('"\'@cmd"');
    expect(csvCell('-2+cmd|calc')).toBe('"\'-2+cmd|calc"');
  });

  it('纯数字原样保留 —— 防注入不能把金额列变成文本', () => {
    expect(csvCell('-2')).toBe('"-2"');
    expect(csvCell('-12.5')).toBe('"-12.5"');
    expect(csvCell('0.0123')).toBe('"0.0123"');
  });

  it('空值写成空串而不是 undefined', () => {
    expect(csvCell(undefined)).toBe('""');
    expect(csvCell(null)).toBe('""');
  });
});

describe('csvAmount', () => {
  it('保留 4 位小数 —— 单次对话常低于 1 分，2 位会全变 0.00', () => {
    expect(csvAmount('0.0123')).toBe('0.0123');
    expect(csvAmount('0.00004')).toBe('0.0000');
    expect(csvAmount(12.5)).toBe('12.5000');
  });

  it('空值与脏数据归零，不写出 NaN', () => {
    expect(csvAmount(undefined)).toBe('0.0000');
    expect(csvAmount('abc')).toBe('0.0000');
  });
});

describe('toCsvRow', () => {
  it('列数与表头一致', () => {
    expect(toCsvRow(record()).split('","').length).toBe(CSV_HEADER.length);
  });

  it('没有使用成员时写空单元格，不写 null 也不写占位符号', () => {
    const row = toCsvRow(record({ memberName: null }));
    expect(row).toContain('"市场调研员","",');
    expect(row).not.toContain('null');
  });

  it('保底计价写成是 / 否', () => {
    expect(toCsvRow(record({ fallbackPricing: true }))).toContain('"是"');
    expect(toCsvRow(record({ fallbackPricing: false }))).toContain('"否"');
  });

  it('成员自付独立成列，不与企业支出混在一起', () => {
    // 混列会让「公司这个月花了多少」把员工自掏的钱算进来
    const row = toCsvRow(
      record({
        costCNY: '10.0000',
        creditPaidCNY: '0.0000',
        walletPaidCNY: '0.3000',
        personalPaidCNY: '9.7000',
      }),
    );
    const cells = row.split(',').map((c) => c.slice(1, -1));
    expect(cells[CSV_HEADER.indexOf('钱包扣减(元)')]).toBe('0.3000');
    expect(cells[CSV_HEADER.indexOf('成员自付(元)')]).toBe('9.7000');
  });

  it('金额列是裸数字，不带 ¥ —— 财务要直接求和', () => {
    const row = toCsvRow(record({ costCNY: '1.2345' }));
    expect(row).toContain('"1.2345"');
    expect(row).not.toContain('¥');
  });
});

describe('buildUsageRecordsCsv', () => {
  it('第一行是表头，其后每条记录一行', () => {
    const csv = buildUsageRecordsCsv([record({ id: 'a' }), record({ id: 'b' })]);
    const lines = csv.split('\n');
    expect(lines[0]).toBe(CSV_HEADER.join(','));
    expect(lines).toHaveLength(3);
  });

  it('空列表也带表头 —— 打开是空表而不是空文件', () => {
    expect(buildUsageRecordsCsv([])).toBe(CSV_HEADER.join(','));
  });
});
