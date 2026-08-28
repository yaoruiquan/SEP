import { describe, expect, it } from 'vitest';
import { previewPathFor } from './use-skill-version';

/**
 * 三条正文路径的授权模型不同，混用就是 403：
 * 贡献中心必须走 author（按 contributorId），企业成员走 enterprise（要订阅授权），
 * 运营审核走 admin。
 */
describe('版本正文的授权路径', () => {
  it('author → 贡献中心的作者端点', () => {
    expect(previewPathFor('author', 'v1')).toBe('/contributions/versions/v1');
  });

  it('enterprise → 企业订阅授权端点', () => {
    expect(previewPathFor('enterprise', 'v1')).toBe('/enterprise/skill-versions/v1/preview');
  });

  it('admin → 运营审核端点', () => {
    expect(previewPathFor('admin', 'v1')).toBe('/admin/skill-versions/v1');
  });
});
