import {
  MODEL_PRICING,
  FALLBACK_PRICING,
  USD_TO_CNY_RATE,
  DEFAULT_USD_TO_CNY_RATE,
  parseUsdToCnyRate,
  hasPricing,
  calculateCost,
} from './index';

describe('保底计费 (fallback pricing)', () => {
  describe('FALLBACK_PRICING', () => {
    it('取 MODEL_PRICING 各维度最高单价', () => {
      const maxIn = Math.max(
        ...Object.values(MODEL_PRICING).map((p) => p.inputPrice),
      );
      const maxOut = Math.max(
        ...Object.values(MODEL_PRICING).map((p) => p.outputPrice),
      );
      expect(FALLBACK_PRICING.inputPrice).toBe(maxIn);
      expect(FALLBACK_PRICING.outputPrice).toBe(maxOut);
    });

    it('不低于任何已配价模型（保证不漏收）', () => {
      for (const [modelId, p] of Object.entries(MODEL_PRICING)) {
        expect(FALLBACK_PRICING.inputPrice).toBeGreaterThanOrEqual(
          p.inputPrice,
        );
        expect(FALLBACK_PRICING.outputPrice).toBeGreaterThanOrEqual(
          p.outputPrice,
        );
      }
      expect(Object.keys(MODEL_PRICING).length).toBeGreaterThan(0);
    });
  });

  describe('hasPricing', () => {
    it('已配价模型返回 true', () => {
      expect(hasPricing('deepseek-v4-flash')).toBe(true);
      expect(hasPricing('claude-haiku-4-5')).toBe(true);
    });

    it('未配价模型返回 false（含带日期后缀的别名）', () => {
      expect(hasPricing('claude-haiku-4-5-20251001')).toBe(false);
      expect(hasPricing('some-unknown-model')).toBe(false);
    });
  });

  describe('calculateCost', () => {
    it('已配价模型按真实价格计费，isFallback=false', () => {
      const { costUSD, costCNY, isFallback } = calculateCost(
        'deepseek-v4-flash',
        1_000_000,
        1_000_000,
      );
      const p = MODEL_PRICING['deepseek-v4-flash'];
      expect(isFallback).toBe(false);
      expect(costUSD).toBeCloseTo(p.inputPrice + p.outputPrice, 10);
      expect(costCNY).toBeCloseTo(costUSD * USD_TO_CNY_RATE, 10);
    });

    it('未配价模型按保底价计费，isFallback=true', () => {
      const { costUSD, isFallback } = calculateCost(
        'claude-haiku-4-5-20251001',
        1_000_000,
        1_000_000,
      );
      expect(isFallback).toBe(true);
      expect(costUSD).toBeCloseTo(
        FALLBACK_PRICING.inputPrice + FALLBACK_PRICING.outputPrice,
        10,
      );
    });

    it('未配价模型绝不为 0（核心：堵住免费对话漏洞）', () => {
      const { costCNY } = calculateCost('brand-new-model', 100, 100);
      expect(costCNY).toBeGreaterThan(0);
    });

    it('复现 E2E 实测值：3/9 tokens 保底价 = ¥0.0010368', () => {
      const { costUSD, costCNY, isFallback } = calculateCost(
        'claude-haiku-4-5-20251001',
        3,
        9,
      );
      expect(isFallback).toBe(true);
      expect(costUSD).toBeCloseTo(0.000144, 9);
      expect(costCNY).toBeCloseTo(0.0010368, 9);
    });

    it('零 token 不产生费用', () => {
      expect(calculateCost('deepseek-v4-flash', 0, 0).costCNY).toBe(0);
    });

    it('传入自定义汇率时按该汇率换算，并回传实际用的 rate', () => {
      const r = calculateCost('deepseek-v4-flash', 1_000_000, 0, 7.5);
      expect(r.rate).toBe(7.5);
      expect(r.costCNY).toBeCloseTo(r.costUSD * 7.5, 10);
    });

    it('省略汇率时用默认值', () => {
      expect(calculateCost('deepseek-v4-flash', 100, 100).rate).toBe(
        DEFAULT_USD_TO_CNY_RATE,
      );
    });
  });

  describe('parseUsdToCnyRate（汇率配置解析）', () => {
    it('解析合法数字字符串', () => {
      expect(parseUsdToCnyRate('7.35')).toBe(7.35);
      expect(parseUsdToCnyRate('8')).toBe(8);
    });

    it('非法输入回退默认值，绝不产生 NaN 账单', () => {
      for (const bad of [undefined, '', 'abc', 'NaN', '0', '-1', 'Infinity']) {
        const r = parseUsdToCnyRate(bad as string | undefined);
        expect(Number.isFinite(r)).toBe(true);
        expect(r).toBeGreaterThan(0);
      }
      expect(parseUsdToCnyRate('abc')).toBe(DEFAULT_USD_TO_CNY_RATE);
      expect(parseUsdToCnyRate('0')).toBe(DEFAULT_USD_TO_CNY_RATE);
      expect(parseUsdToCnyRate('-1')).toBe(DEFAULT_USD_TO_CNY_RATE);
    });

    it('非法汇率不会让金额变成 NaN', () => {
      const rate = parseUsdToCnyRate('not-a-number');
      const { costCNY } = calculateCost('deepseek-v4-flash', 1000, 1000, rate);
      expect(Number.isFinite(costCNY)).toBe(true);
      expect(costCNY).toBeGreaterThan(0);
    });

    it('未配价模型比同等用量的最便宜已配价模型更贵', () => {
      const cheapest = Object.keys(MODEL_PRICING).reduce((a, b) =>
        MODEL_PRICING[a].inputPrice + MODEL_PRICING[a].outputPrice <
        MODEL_PRICING[b].inputPrice + MODEL_PRICING[b].outputPrice
          ? a
          : b,
      );
      const fb = calculateCost('unknown-x', 1000, 1000).costCNY;
      const ch = calculateCost(cheapest, 1000, 1000).costCNY;
      expect(fb).toBeGreaterThan(ch);
    });
  });
});
