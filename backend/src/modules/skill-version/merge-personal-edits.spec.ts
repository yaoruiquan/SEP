import { mergePersonalEdits } from './merge-personal-edits';

/**
 * 一键采纳多人改动的合并逻辑。
 *
 * 这里每一条都是「错了不会报错、只会静默少生效一个人的改动」的场景 ——
 * 上一版就是这么丢掉一个人的：界面说采纳了 2 条，实际只生效 1 条。
 */
describe('mergePersonalEdits', () => {
  const baseline = ['# 标题', '', '正文第一段', '正文第二段', '结尾'].join('\n');

  it('单份副本直接返回它的正文，不做任何合并', () => {
    const result = mergePersonalEdits(baseline, [{ label: '甲', content: 'anything' }]);
    expect(result.content).toBe('anything');
    expect(result.conflicts).toHaveLength(0);
  });

  it('没有来源时返回基线', () => {
    expect(mergePersonalEdits(baseline, []).content).toBe(baseline);
  });

  it('两人在不同位置各加一段 —— 两段都要在', () => {
    const a = baseline.replace('# 标题', '# 标题\n\n## 甲的规范\n- 甲的第一条');
    const b = baseline.replace('结尾', '## 乙的红线\n- 乙的第一条\n结尾');
    const result = mergePersonalEdits(baseline, [
      { label: '甲', content: a },
      { label: '乙', content: b },
    ]);
    expect(result.content).toContain('甲的规范');
    expect(result.content).toContain('乙的红线');
    expect(result.conflicts).toHaveLength(0);
  });

  it('两人在同一位置各加一段 —— 也都要在，顺序按传入顺序', () => {
    const a = baseline.replace('# 标题', '# 标题\n甲加的行');
    const b = baseline.replace('# 标题', '# 标题\n乙加的行');
    const result = mergePersonalEdits(baseline, [
      { label: '甲', content: a },
      { label: '乙', content: b },
    ]);
    expect(result.content).toContain('甲加的行');
    expect(result.content).toContain('乙加的行');
    expect(result.content.indexOf('甲加的行')).toBeLessThan(result.content.indexOf('乙加的行'));
  });

  it('两人加了同一行时不重复', () => {
    const same = baseline.replace('# 标题', '# 标题\n共同的规范');
    const result = mergePersonalEdits(baseline, [
      { label: '甲', content: same },
      { label: '乙', content: same },
    ]);
    expect(result.content.match(/共同的规范/g)).toHaveLength(1);
    expect(result.conflicts).toHaveLength(0);
  });

  it('一人删除某行 —— 合并结果里该行消失', () => {
    const a = baseline.replace('正文第二段\n', '');
    const result = mergePersonalEdits(baseline, [
      { label: '甲', content: a },
      { label: '乙', content: baseline },
    ]);
    expect(result.content).not.toContain('正文第二段');
    expect(result.content).toContain('正文第一段');
  });

  it('两人把同一行改成不同内容 —— 记为冲突并如实报告', () => {
    const a = baseline.replace('正文第二段', '甲改写的第二段');
    const b = baseline.replace('正文第二段', '乙改写的第二段');
    const result = mergePersonalEdits(baseline, [
      { label: '甲', content: a },
      { label: '乙', content: b },
    ]);
    expect(result.conflicts).toHaveLength(1);
    expect(result.conflicts[0].baselineText).toBe('正文第二段');
    expect(result.conflicts[0].variants.map((v) => v.label)).toEqual(['甲', '乙']);
    // 两个版本都保留在正文里，让管理员看到并取舍 —— 静默丢一个才是上一版的错误
    expect(result.content).toContain('甲改写的第二段');
    expect(result.content).toContain('乙改写的第二段');
  });

  it('两人做了完全相同的修改时不算冲突', () => {
    const same = baseline.replace('正文第二段', '改写后的第二段');
    const result = mergePersonalEdits(baseline, [
      { label: '甲', content: same },
      { label: '乙', content: same },
    ]);
    expect(result.conflicts).toHaveLength(0);
    expect(result.content.match(/改写后的第二段/g)).toHaveLength(1);
  });

  it('在开头插入不会被误判成整篇重写', () => {
    const a = `新的第一行\n${baseline}`;
    const result = mergePersonalEdits(baseline, [
      { label: '甲', content: a },
      { label: '乙', content: baseline },
    ]);
    // 逐行比对会在这里把整篇都标成改动，于是合并出两份正文首尾相接
    expect(result.content).toBe(`新的第一行\n${baseline}`);
  });

  it('三人各加一段时全部保留', () => {
    const sources = ['甲', '乙', '丙'].map((label) => ({
      label,
      content: baseline.replace('结尾', `## ${label}的段落\n结尾`),
    }));
    const result = mergePersonalEdits(baseline, sources);
    expect(result.content).toContain('甲的段落');
    expect(result.content).toContain('乙的段落');
    expect(result.content).toContain('丙的段落');
  });

  it('末尾追加的内容不会丢', () => {
    const a = `${baseline}\n甲的附录`;
    const b = `${baseline}\n乙的附录`;
    const result = mergePersonalEdits(baseline, [
      { label: '甲', content: a },
      { label: '乙', content: b },
    ]);
    expect(result.content).toContain('甲的附录');
    expect(result.content).toContain('乙的附录');
  });
});
