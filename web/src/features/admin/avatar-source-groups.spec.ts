import { describe, expect, it } from 'vitest';
import { canBindAvatarStyle, groupAvatarStyles } from './avatar-source-groups';
import type { ManagedAvatarStyle } from './admin-api';
const style = (source: string, extra = {}): ManagedAvatarStyle => ({
  id: source, name: source, description: '', category: '', recommended: false, source,
  examples: [], coverage: { matched: 0, total: 0 }, canSetDefault: true, ...extra,
});
describe('Avatar source metadata', () => {
  it('后端来源元数据优先，未知来源独立分类，不冒充平台素材', () => {
    const groups = groupAvatarStyles([style('future', { sourceName: '新素材库' }), style('dicebear')], [
      { id: 'dicebear', name: 'DiceBear 官方', description: '服务端说明', website: 'https://www.dicebear.com/' },
    ]);
    expect(groups[0].name).toBe('DiceBear 官方');
    expect(groups[1].name).toBe('新素材库');
    expect(groups[1].id).toBe('future');
  });
  it('只开放自有绑定和原版静态包的个人素材覆盖，兼容旧接口', () => {
    expect(canBindAvatarStyle(style('platform'))).toBe(true);
    expect(canBindAvatarStyle(style('open-peeps', { delivery: 'static' }))).toBe(true);
    expect(canBindAvatarStyle(style('dicebear', { delivery: 'generated' }))).toBe(false);
    expect(canBindAvatarStyle(style('unknown'))).toBe(false);
    expect(canBindAvatarStyle(style('robohash', { delivery: 'static' }))).toBe(true);
    expect(canBindAvatarStyle(style('beanheads', { delivery: 'generated' }))).toBe(false);
  });
  it('Bean Heads 和 RoboHash 在缺少服务端来源说明时仍各自分类', () => {
    const groups = groupAvatarStyles([style('robohash'), style('beanheads')]);
    expect(groups.map((group) => [group.id, group.name])).toEqual([
      ['beanheads', 'Bean Heads'], ['robohash', 'RoboHash'],
    ]);
  });
});
