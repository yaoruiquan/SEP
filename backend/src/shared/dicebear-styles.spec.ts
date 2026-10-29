import { BUILTIN_AVATAR_STYLES, canonicalAvatarStyleId, libraryAvatarBinding } from './dicebear-styles';
import { inferAvatarStyle } from '../common/avatar-style';

describe('Local avatar identity', () => {
  it('canonical 风格标识保持唯一，旧 DiceBear 风格仍兼容', () => {
    expect(new Set(BUILTIN_AVATAR_STYLES.map((style) => style.id)).size).toBe(BUILTIN_AVATAR_STYLES.length);
    expect(canonicalAvatarStyleId('micah')).toBe('cartoon:micah');
    expect(canonicalAvatarStyleId('boring-beam')).toBe('boring-beam');
  });
  it('本地生成地址和历史 API 地址均能推断风格', () => {
    expect(inferAvatarStyle('https://api.dicebear.com/9.x/micah/svg?seed=old')).toBe('cartoon:micah');
    expect(inferAvatarStyle('/avatar-library/v1/dicebear/toon-head?seed=fixed')).toBe('cartoon:toon-head');
    expect(inferAvatarStyle('https://sep.example/avatar-library/v1/boring-avatars/beam?seed=fixed')).toBe('boring-beam');
    expect(inferAvatarStyle('/avatar-library/v1/ui-avatars/brand?seed=fixed')).toBe('ui-avatars-brand');
    expect(inferAvatarStyle('/avatar-library/v1/beanheads/professional?seed=fixed')).toBe('beanheads-professional');
  });
  it.each(['robohash-set1', 'robohash-set3'])('机器人 %s 按 seed 固定分配本地 PNG 和内容版本', (style) => {
    const first = libraryAvatarBinding(style, 'employee-1');
    expect(first?.portraitUrl).toMatch(/^\/assets\/avatar-libraries\/robohash\/set[13]-\d{3}\.png$/);
    expect(first?.faceUrl).toBe(first?.portraitUrl);
    expect(first?.version).toMatch(/^[a-f0-9]{16}$/);
    expect(libraryAvatarBinding(style, 'employee-1', '改名后')).toEqual(first);
  });
  it('固定 seed 恢复同一原版人物，提供裁切图，未知风格不会生成空地址', () => {
    const first = libraryAvatarBinding('open-peeps-busts', 'employee-1');
    expect(libraryAvatarBinding('open-peeps-busts', 'employee-1')).toEqual(first);
    expect(first?.faceUrl).toContain('-face.svg');
    expect(libraryAvatarBinding('does-not-exist', 'employee-1')).toBeNull();
  });
});
