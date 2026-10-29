// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { DICEBEAR_STYLES, ADDITIONAL_AVATAR_STYLES } from 'shared/dicebear-styles';
import { GET } from './route';

const requestAvatar = (source: string, style: string, query = 'seed=employee-1', version = 'v1', headers?: HeadersInit) =>
  GET(new Request(`http://localhost/avatar-library/${version}/${source}/${style}?${query}`, { headers }), {
    params: Promise.resolve({ version, source, style }),
  });

describe('Platform avatar renderer', () => {
  it.each(DICEBEAR_STYLES.map((style) => [style.id]))('真正渲染 DiceBear %s，固定 seed 保持结果', async (style) => {
    const first = await requestAvatar('dicebear', style);
    expect(first.status).toBe(200);
    const svg = await first.text();
    expect(svg).toContain('<svg');
    expect(svg).not.toMatch(/<script|<foreignObject|(?:href|src)=["']https?:/);
    expect(first.headers.get('content-type')).toContain('image/svg+xml');
    expect(await (await requestAvatar('dicebear', style)).text()).toBe(svg);
  });
  it.each(ADDITIONAL_AVATAR_STYLES.filter((style) => style.source === 'boring-avatars').map((style) => [style.styleId!]))(
    '真正渲染官方 Boring Avatars %s', async (style) => {
      const first = await requestAvatar('boring-avatars', style);
      expect(first.status).toBe(200);
      expect(await first.text()).toContain('<svg');
    },
  );
  it('中文姓名可用，输入不会注入 SVG 标记', async () => {
    const chinese = await requestAvatar('ui-avatars', 'brand', 'seed=fixed&name=%E4%BA%A7%E5%93%81%E7%BB%8F%E7%90%86');
    expect(await chinese.text()).toContain('产品</text>');
    const escaped = await requestAvatar('ui-avatars', 'brand', `seed=fixed&name=${encodeURIComponent('<script>alert(1)</script>')}`);
    expect(await escaped.text()).not.toContain('<script>');
  });
  it('Bean Heads 使用真实职业人物组件、许可元数据，并按 seed 固定生成', async () => {
    const first = await requestAvatar('beanheads', 'professional');
    expect(first.status).toBe(200);
    const svg = await first.text();
    expect(svg).toContain('<svg');
    expect(svg).toContain('Bean Heads by Robert Broersma');
    expect(svg).not.toMatch(/<script|<foreignObject|(?:href|src)=["']https?:/);
    expect(await (await requestAvatar('beanheads', 'professional')).text()).toBe(svg);
    expect(await (await requestAvatar('beanheads', 'professional', 'seed=employee-2')).text()).not.toBe(svg);
    expect((await requestAvatar('beanheads', 'unknown')).status).toBe(404);
    expect((await requestAvatar('beanheads', 'constructor')).status).toBe(404);
    const cached = await requestAvatar('beanheads', 'professional', 'seed=employee-1', 'v1', { 'if-none-match': first.headers.get('etag')! });
    expect(cached.status).toBe(304);
  });
  it('使用内容 ETag 支持304，避免重复下载', async () => {
    const first = await requestAvatar('dicebear', 'lorelei');
    const second = await requestAvatar('dicebear', 'lorelei', 'seed=employee-1', 'v1', { 'if-none-match': first.headers.get('etag')! });
    expect(second.status).toBe(304);
    expect(await second.text()).toBe('');
    expect(first.headers.get('cache-control')).toContain('public');
  });
  it('拒绝未知来源、风格、旧版本与过长参数', async () => {
    expect((await requestAvatar('unknown', 'lorelei')).status).toBe(404);
    expect((await requestAvatar('dicebear', 'constructor')).status).toBe(404);
    expect((await requestAvatar('dicebear', 'lorelei', 'seed=test', 'v0')).status).toBe(404);
    expect((await requestAvatar('dicebear', 'lorelei', `seed=${'x'.repeat(129)}`)).status).toBe(400);
    expect((await requestAvatar('ui-avatars', 'brand', `seed=x&name=${'x'.repeat(101)}`)).status).toBe(400);
  });
});
