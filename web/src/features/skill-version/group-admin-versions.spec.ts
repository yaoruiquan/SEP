import { describe, expect, it } from 'vitest';
import { PLATFORM_GROUP_KEY, compareVersionDesc, groupAdminVersions } from './group-admin-versions';
import type { AdminVersionRow } from './group-admin-versions';

function row(overrides: Partial<AdminVersionRow> & { version: string }): AdminVersionRow {
  return {
    id: `v-${overrides.version}-${overrides.capability?.id ?? 'ui'}`,
    capabilityId: overrides.capability?.id ?? 'cap-ui',
    scope: 'ENTERPRISE',
    enterpriseId: 'ent-1',
    parentVersionId: null,
    sourceVersionId: null,
    changeSummary: null,
    status: 'ENTERPRISE_APPROVED',
    createdAt: '2026-09-01T00:00:00.000Z',
    updatedAt: '2026-09-01T00:00:00.000Z',
    capability: { id: 'cap-ui', name: 'UI Designer', description: '' },
    enterprise: { id: 'ent-1', name: '示例科技有限公司' },
    ...overrides,
  };
}

describe('groupAdminVersions', () => {
  it('collapses one enterprise × one skill into a single card with the newest version on top', () => {
    // 界面上看到的顺序就是这样跳的：按 updatedAt 排，版本号乱序
    const groups = groupAdminVersions([
      row({ version: '1.0.3', updatedAt: '2026-09-04T03:00:00.000Z' }),
      row({ version: '1.0.4', updatedAt: '2026-09-04T02:00:00.000Z' }),
      row({ version: '1.0.1', updatedAt: '2026-09-04T01:00:00.000Z' }),
      row({ version: '1.0.8', updatedAt: '2026-09-02T00:00:00.000Z' }),
    ]);

    expect(groups).toHaveLength(1);
    expect(groups[0].name).toBe('示例科技有限公司');
    expect(groups[0].versionCount).toBe(4);
    expect(groups[0].capabilities).toHaveLength(1);
    // 最新的是 1.0.8，尽管它的 updatedAt 最旧 —— 版本号才是「哪一版更新」的答案
    expect(groups[0].capabilities[0].latest.version).toBe('1.0.8');
    expect(groups[0].capabilities[0].older.map((item) => item.version)).toEqual([
      '1.0.4',
      '1.0.3',
      '1.0.1',
    ]);
  });

  it('separates enterprises and puts platform-authored versions in their own bucket', () => {
    const groups = groupAdminVersions([
      row({ version: '1.0.0', updatedAt: '2026-09-04T05:00:00.000Z' }),
      row({
        version: '2.0.0',
        scope: 'PLATFORM',
        enterpriseId: null,
        enterprise: null,
        updatedAt: '2026-09-03T00:00:00.000Z',
        capability: { id: 'cap-arch', name: 'Software Architect', description: '' },
      }),
      row({
        version: '1.1.0',
        enterpriseId: 'ent-2',
        enterprise: { id: 'ent-2', name: '常州数易网络科技有限公司' },
        updatedAt: '2026-09-04T01:00:00.000Z',
      }),
    ]);

    expect(groups.map((group) => group.key)).toEqual(['ent-1', 'ent-2', PLATFORM_GROUP_KEY]);
    expect(groups[2].isPlatform).toBe(true);
    expect(groups[2].name).toBe('平台自建');
  });

  it('orders skills inside an enterprise by most recent activity', () => {
    const groups = groupAdminVersions([
      row({ version: '1.0.0', updatedAt: '2026-08-01T00:00:00.000Z' }),
      row({
        version: '1.0.0',
        updatedAt: '2026-09-04T00:00:00.000Z',
        capability: { id: 'cap-arch', name: 'Software Architect', description: '' },
      }),
    ]);

    expect(groups[0].capabilities.map((item) => item.capabilityName)).toEqual([
      'Software Architect',
      'UI Designer',
    ]);
  });

  it('falls back to updatedAt when a version string is not semver', () => {
    const legacy = row({ version: 'v1-legacy', updatedAt: '2026-09-04T00:00:00.000Z' });
    const semver = row({ version: '1.0.9', updatedAt: '2026-09-01T00:00:00.000Z' });

    expect(compareVersionDesc(legacy, semver)).toBeLessThan(0);
    expect(groupAdminVersions([semver, legacy])[0].capabilities[0].latest.version).toBe('v1-legacy');
  });
});
