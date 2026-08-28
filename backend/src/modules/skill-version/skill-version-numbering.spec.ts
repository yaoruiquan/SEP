import { nextSemver } from './skill-version-numbering';

describe('nextSemver', () => {
  it('第一个版本是 1.0.0', () => {
    expect(nextSemver([])).toBe('1.0.0');
  });

  it('在最大版本上加补丁位，与列表顺序无关', () => {
    expect(nextSemver(['1.0.0', '1.0.5', '1.0.2'])).toBe('1.0.6');
    expect(nextSemver(['1.0.5', '1.0.0'])).toBe('1.0.6');
  });

  it('按 major → minor → patch 逐段比较，不做字符串比较', () => {
    // 字符串比较会认为 '1.0.9' > '1.0.10'
    expect(nextSemver(['1.0.9', '1.0.10'])).toBe('1.0.11');
    expect(nextSemver(['2.0.0', '1.9.9'])).toBe('2.0.1');
    expect(nextSemver(['1.10.0', '1.9.0'])).toBe('1.10.1');
  });

  it('忽略非 semver 的历史值', () => {
    expect(nextSemver(['v1', 'latest', '1.0.3'])).toBe('1.0.4');
    expect(nextSemver(['草稿', ''])).toBe('1.0.0');
  });

  it('删掉中间版本后不会撞号（曾经的 `1.0.${count}` 会）', () => {
    // 有 1.0.0 / 1.0.1 / 1.0.2，删掉 1.0.1 后 count=2，旧规则会算出已存在的 1.0.2
    expect(nextSemver(['1.0.0', '1.0.2'])).toBe('1.0.3');
  });
});
