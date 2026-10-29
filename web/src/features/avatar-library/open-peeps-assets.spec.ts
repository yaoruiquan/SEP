// @vitest-environment node
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import assets from 'shared/open-peeps-assets.json';

describe('Original Open Peeps static asset packs', () => {
  it('三个素材包全部包含可部署的主图、头像裁切图和正确版本', () => {
    expect(Object.fromEntries(Object.entries(assets).map(([pack, list]) => [pack, list.length])))
      .toEqual({ busts: 49, standing: 30, sitting: 14 });
    for (const asset of Object.values(assets).flat()) {
      const portrait = readFileSync(resolve('public', asset.portraitUrl.slice(1)), 'utf8');
      const face = readFileSync(resolve('public', asset.faceUrl.slice(1)), 'utf8');
      expect(portrait).toContain('<svg');
      expect(face).toContain('width="256px"');
      const crop = face.match(/viewBox="([^\"]+)"/)![1].split(' ').map(Number);
      expect(crop[2]).toBe(crop[3]);
      expect(createHash('sha256').update(portrait + face).digest('hex').slice(0, 16)).toBe(asset.version);
      expect(portrait).not.toMatch(/<script|<foreignObject|<image|(?:href|src)=["']https?:/i);
      expect(asset.originalUrl).toContain('cdn.prod.website-files.com/');
    }
  });
});
