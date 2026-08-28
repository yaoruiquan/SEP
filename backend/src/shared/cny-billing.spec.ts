/**
 * 人民币口径的计价与金额解析。
 *
 * 这些是账本的入口函数：任何一个把非法值放过去的分支，最终都会在
 * Decimal 列上变成一个没人能解释的金额。
 */
import {
  CnyAmountSchema,
  calculateCost,
  parseCnyAmount,
  parseFallbackPriceConfig,
  MODEL_PRICING,
  FALLBACK_PRICING,
} from './index';

describe('parseCnyAmount', () => {
  it('正常金额四舍五入到两位小数', () => {
    expect(parseCnyAmount('1000')).toBe(1000);
    expect(parseCnyAmount('12.345')).toBe(12.35);
    expect(parseCnyAmount('0')).toBe(0);
  });

  it('空值与缺省回退到 fallback，而不是 0/NaN', () => {
    // 空字符串是「没配」，不是「配成 0」—— 混淆两者会让系统默认值失效
    expect(parseCnyAmount(undefined, 500)).toBe(500);
    expect(parseCnyAmount('', 500)).toBe(500);
    expect(parseCnyAmount('   ', 500)).toBe(500);
  });

  it('❗非法与负数一律回退，绝不把 NaN 或负数写进账本', () => {
    expect(parseCnyAmount('abc', 10)).toBe(10);
    expect(parseCnyAmount('-5', 10)).toBe(10);
    expect(parseCnyAmount('Infinity', 10)).toBe(10);
  });
});

describe('CnyAmountSchema', () => {
  it('接受非负、最多两位小数的金额', () => {
    expect(CnyAmountSchema.safeParse(0).success).toBe(true);
    expect(CnyAmountSchema.safeParse(1000).success).toBe(true);
    expect(CnyAmountSchema.safeParse(12.34).success).toBe(true);
    expect(CnyAmountSchema.safeParse(0.07).success).toBe(true);
  });

  it('❗拒绝负数与三位以上小数 —— 否则会在 Decimal 列被静默截断', () => {
    expect(CnyAmountSchema.safeParse(-1).success).toBe(false);
    expect(CnyAmountSchema.safeParse(0.001).success).toBe(false);
    expect(CnyAmountSchema.safeParse(1.2345).success).toBe(false);
    expect(CnyAmountSchema.safeParse(Number.NaN).success).toBe(false);
  });
});

describe('parseFallbackPriceConfig', () => {
  it('两项都合法时生效', () => {
    expect(parseFallbackPriceConfig('0.001', '0.002')).toEqual({
      inputCnyPer1K: 0.001,
      outputCnyPer1K: 0.002,
    });
  });

  it('允许 0（运营明确「未配价模型免费」）', () => {
    expect(parseFallbackPriceConfig('0', '0')).toEqual({
      inputCnyPer1K: 0,
      outputCnyPer1K: 0,
    });
  });

  it('❗只配一半时整体不生效 —— 半套配置会让账单口径无法解释', () => {
    expect(parseFallbackPriceConfig('0.001', undefined)).toBeNull();
    expect(parseFallbackPriceConfig(undefined, '0.002')).toBeNull();
    expect(parseFallbackPriceConfig('', '')).toBeNull();
    expect(parseFallbackPriceConfig('abc', '0.002')).toBeNull();
    expect(parseFallbackPriceConfig('-1', '0.002')).toBeNull();
  });
});

describe('calculateCost —— 运营配置的保底价', () => {
  const RATE = 7.2;

  it('已配价模型不受保底价配置影响', () => {
    const withConfig = calculateCost('gpt-4o', 1_000_000, 1_000_000, RATE, {
      inputCnyPer1K: 99,
      outputCnyPer1K: 99,
    });
    const withoutConfig = calculateCost('gpt-4o', 1_000_000, 1_000_000, RATE);

    expect(withConfig.isFallback).toBe(false);
    expect(withConfig.costCNY).toBeCloseTo(withoutConfig.costCNY, 6);
    expect(withConfig.inputPriceUsdPerMillion).toBe(
      MODEL_PRICING['gpt-4o'].inputPrice,
    );
  });

  it('未配价模型按运营配置的人民币单价计费', () => {
    // 1000 输入 + 500 输出，单价 0.001 / 0.002 元每 1K tokens
    const result = calculateCost('unknown-model', 1000, 500, RATE, {
      inputCnyPer1K: 0.001,
      outputCnyPer1K: 0.002,
    });

    expect(result.isFallback).toBe(true);
    expect(result.costCNY).toBeCloseTo(0.001 + 0.001, 9);
  });

  it('未配价模型且未配保底价时，回退「已知模型最高单价」', () => {
    const result = calculateCost('unknown-model', 1000, 500, RATE, null);

    expect(result.isFallback).toBe(true);
    expect(result.inputPriceUsdPerMillion).toBe(FALLBACK_PRICING.inputPrice);
    expect(result.outputPriceUsdPerMillion).toBe(FALLBACK_PRICING.outputPrice);
  });

  it('账单可复核：返回本次实际使用的单价与汇率', () => {
    const result = calculateCost('unknown-model', 1000, 1000, RATE, {
      inputCnyPer1K: 0.0072,
      outputCnyPer1K: 0.0144,
    });

    // 人民币单价换算回等价美元单价存档，让账单字段对所有模型保持同一含义
    expect(result.rate).toBe(RATE);
    expect(result.inputPriceUsdPerMillion).toBeCloseTo(1, 6);
    expect(result.outputPriceUsdPerMillion).toBeCloseTo(2, 6);
  });

  it('❗0 token 的调用成本为 0，不会因保底价产生凭空扣费', () => {
    const result = calculateCost('unknown-model', 0, 0, RATE, {
      inputCnyPer1K: 1,
      outputCnyPer1K: 1,
    });
    expect(result.costCNY).toBe(0);
  });

  it('模型切换只改变成本，不改变账本口径（成本随单价线性变化）', () => {
    const cheap = calculateCost('gpt-4o-mini', 10_000, 10_000, RATE);
    const pricey = calculateCost('claude-sonnet-5', 10_000, 10_000, RATE);

    expect(pricey.costCNY).toBeGreaterThan(cheap.costCNY);
    // 两者都不是保底价，说明「换模型」不会把账单切到另一套价格体系
    expect(cheap.isFallback).toBe(false);
    expect(pricey.isFallback).toBe(false);
  });
});
