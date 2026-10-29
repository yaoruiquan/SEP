// @vitest-environment node
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import assets from 'shared/robohash-assets.json';

describe('Local RoboHash robot packs', () => {
  it('两个机器人包包含 64 个独立 PNG、来源地址和正确版本', () => {
    expect(Object.fromEntries(Object.entries(assets).map(([pack, list]) => [pack, list.length])))
      .toEqual({ set1: 32, set3: 32 });
    const hashes = new Set<string>();
    for (const [pack, list] of Object.entries(assets)) {
      for (const asset of list) {
        const png = readFileSync(resolve('public', asset.portraitUrl.slice(1)));
        expect(png.subarray(0, 8).toString('hex')).toBe('89504e470d0a1a0a');
        expect([png.readUInt32BE(16), png.readUInt32BE(20)]).toEqual([256, 256]);
        expect(asset.faceUrl).toBe(asset.portraitUrl);
        expect(png.toString('latin1')).toContain('Robots lovingly delivered by Robohash.org.');
        expect(png.toString('latin1')).toContain('https://creativecommons.org/licenses/by/3.0/');
        expect(png.toString('latin1')).toContain(asset.originalUrl);
        expect(createHash('sha256').update(png).digest('hex').slice(0, 16)).toBe(asset.version);
        expect(asset.originalUrl).toMatch(new RegExp(`^https://robohash.org/[^?]+\\.png\\?set=${pack}&size=256x256$`));
        hashes.add(asset.version);
      }
    }
    expect(hashes.size).toBe(64);
    const license = readFileSync(resolve('public/assets/avatar-libraries/robohash/LICENSE.txt'), 'utf8');
    expect(license).toContain('Zikri Kader');
    expect(license).toContain('Julian Peter Arias');
    expect(license).toContain('https://creativecommons.org/licenses/by/3.0/');
  });
});
