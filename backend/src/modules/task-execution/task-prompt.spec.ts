import { buildStepPrompt, HANDOFF_EXCERPT_CHARS } from './task-prompt';

describe('buildStepPrompt', () => {
  const base = {
    objective: '给新款保温杯做小红书投放方案',
    stepTitle: '写三条文案',
    stepDescription: '基于调研结论产出三条文案',
  };

  it('没有上游时不产生交接记录，也不出现交接段落', () => {
    const { prompt, handoff } = buildStepPrompt({ ...base, upstream: [] });

    expect(handoff).toEqual([]);
    expect(prompt).not.toContain('上游同事已经交付的内容');
    expect(prompt).toContain('总目标：给新款保温杯做小红书投放方案');
    expect(prompt).toContain('当前步骤：写三条文案');
    expect(prompt).toContain('请只完成当前步骤');
  });

  it('交接内容带上「谁交的」，让员工接力在 prompt 里可辨认', () => {
    const { prompt, handoff } = buildStepPrompt({
      ...base,
      upstream: [
        { stepKey: 'step-1', stepTitle: '竞品调研', employeeName: '市场调研员', output: '竞品A 89 元' },
        { stepKey: 'step-2', stepTitle: '人群画像', employeeName: '数据分析师', output: '25-34 岁女性为主' },
      ],
    });

    expect(handoff).toHaveLength(2);
    expect(handoff[0]).toMatchObject({
      fromStepKey: 'step-1',
      fromStepTitle: '竞品调研',
      fromEmployeeName: '市场调研员',
      excerpt: '竞品A 89 元',
      chars: '竞品A 89 元'.length,
    });
    expect(prompt).toContain('【市场调研员 · 竞品调研】');
    expect(prompt).toContain('【数据分析师 · 人群画像】');
  });

  it('上游没有产出（跳过或空回复）时不算交接', () => {
    const { prompt, handoff } = buildStepPrompt({
      ...base,
      upstream: [
        { stepKey: 'step-1', stepTitle: '竞品调研', employeeName: '市场调研员', output: null },
        { stepKey: 'step-2', stepTitle: '人群画像', employeeName: '数据分析师', output: '   ' },
      ],
    });

    expect(handoff).toEqual([]);
    expect(prompt).not.toContain('上游同事已经交付的内容');
  });

  it('摘要截断但 chars 记全长 —— 「交接了多少」不能被截断骗过去', () => {
    const long = 'x'.repeat(HANDOFF_EXCERPT_CHARS + 250);
    const { prompt, handoff } = buildStepPrompt({
      ...base,
      upstream: [{ stepKey: 'step-1', stepTitle: '调研', employeeName: '市场调研员', output: long }],
    });

    expect(handoff[0].excerpt).toHaveLength(HANDOFF_EXCERPT_CHARS + 1); // 含省略号
    expect(handoff[0].excerpt.endsWith('…')).toBe(true);
    expect(handoff[0].chars).toBe(long.length);
    // prompt 里给模型的是全文，不是摘要 —— 截断只为界面展示
    expect(prompt).toContain(long);
  });
});
