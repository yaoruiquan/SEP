import { describe, expect, it } from 'vitest';
import { diffLines } from './diff-lines';

/**
 * 差异折叠的边界。
 *
 * 这些是「写错了不报错、只是显示得不对」的地方：漏了一行改动、或者把整篇正文
 * 都当成变化行铺出来，界面上都不会报错，只是管理员看不出改了什么。
 */
describe('diffLines', () => {
  it('内容相同时全部折叠成一个 gap', () => {
    const text = ['a', 'b', 'c'].join('\n');
    const rows = diffLines(text, text);
    expect(rows).toEqual([{ type: 'gap', text: '' }]);
    expect(rows.filter((row) => row.type !== 'same' && row.type !== 'gap')).toHaveLength(0);
  });

  it('改一行会同时给出删除行和新增行', () => {
    const rows = diffLines('a\nb\nc', 'a\nB\nc');
    expect(rows.filter((row) => row.type === 'removed').map((row) => row.text)).toEqual(['b']);
    expect(rows.filter((row) => row.type === 'added').map((row) => row.text)).toEqual(['B']);
  });

  it('保留变化行周围两行上下文', () => {
    const before = Array.from({ length: 20 }, (_, i) => `line${i}`).join('\n');
    const after = before.replace('line10', 'CHANGED');
    const rows = diffLines(before, after);
    const same = rows.filter((row) => row.type === 'same').map((row) => row.text);
    expect(same).toContain('line8');
    expect(same).toContain('line9');
    expect(same).toContain('line11');
    expect(same).toContain('line12');
    // 远处的行必须被折叠掉，否则 500 行正文改一处也要滚整篇
    expect(same).not.toContain('line0');
    expect(same).not.toContain('line19');
  });

  it('远处的多段改动之间用 gap 隔开，而不是连成一片', () => {
    const before = Array.from({ length: 30 }, (_, i) => `line${i}`).join('\n');
    const after = before.replace('line2', 'X').replace('line25', 'Y');
    const rows = diffLines(before, after);
    expect(rows.filter((row) => row.type === 'gap').length).toBeGreaterThanOrEqual(1);
    expect(rows.filter((row) => row.type === 'added').map((row) => row.text)).toEqual(['X', 'Y']);
  });

  it('纯新增（基线为空行）时不丢内容', () => {
    const rows = diffLines('', 'new line');
    expect(rows.filter((row) => row.type === 'added').map((row) => row.text)).toEqual(['new line']);
  });

  it('末尾追加多行时全部标为新增', () => {
    const rows = diffLines('a\nb', 'a\nb\nc\nd');
    expect(rows.filter((row) => row.type === 'added').map((row) => row.text)).toEqual(['c', 'd']);
    expect(rows.filter((row) => row.type === 'removed')).toHaveLength(0);
  });

  it('删除整段时不产生新增行', () => {
    const rows = diffLines('a\nb\nc\nd', 'a\nd');
    expect(rows.filter((row) => row.type === 'removed').map((row) => row.text)).toEqual(['b', 'c']);
    expect(rows.filter((row) => row.type === 'added')).toHaveLength(0);
  });
});
