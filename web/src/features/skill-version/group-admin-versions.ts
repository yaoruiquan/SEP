import type { SkillVersionSummary } from '@/lib/types';

/**
 * 把运营的技能版本列表按「企业 → 技能」两级折起来。
 *
 * 扁平列表按 updatedAt 排，同一个企业同一个技能的九个版本会被别的行隔开，
 * 版本号还跳着走（1.0.3 → 1.0.4 → 1.0.1 → 1.0.8）—— 运营要判断的是
 * 「这家企业把这个技能改成了什么样，值不值得收回平台」，那就该以
 * 企业×技能为一个单位，最新一版摆在外面，更早的收进折叠区。
 */

export interface AdminVersionRow extends SkillVersionSummary {
  capability: { id: string; name: string; description: string };
  enterprise: { id: string; name: string } | null;
}

export interface CapabilityGroup {
  capabilityId: string;
  capabilityName: string;
  /** 最新一版：版本号能比就按 semver 比，比不了退到 updatedAt */
  latest: AdminVersionRow;
  older: AdminVersionRow[];
}

export interface EnterpriseGroup {
  /** 企业 id；平台自建版本没有企业，归到这个固定 key 下 */
  key: string;
  name: string;
  isPlatform: boolean;
  versionCount: number;
  capabilities: CapabilityGroup[];
}

export const PLATFORM_GROUP_KEY = '__platform__';

const SEMVER = /^(\d+)\.(\d+)\.(\d+)$/;

/** 版本号新的排前面。非 semver 的历史值排不出大小，退到 updatedAt。 */
export function compareVersionDesc(a: AdminVersionRow, b: AdminVersionRow): number {
  const left = a.version.match(SEMVER)?.slice(1).map(Number);
  const right = b.version.match(SEMVER)?.slice(1).map(Number);
  if (left && right) {
    return right[0] - left[0] || right[1] - left[1] || right[2] - left[2];
  }
  return updatedAtDesc(a, b);
}

function updatedAtDesc(a: { updatedAt: string }, b: { updatedAt: string }) {
  return new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime();
}

export function groupAdminVersions(rows: readonly AdminVersionRow[]): EnterpriseGroup[] {
  const byEnterprise = new Map<string, AdminVersionRow[]>();
  for (const row of rows) {
    const key = row.enterprise?.id ?? PLATFORM_GROUP_KEY;
    const bucket = byEnterprise.get(key);
    if (bucket) bucket.push(row);
    else byEnterprise.set(key, [row]);
  }

  const groups: EnterpriseGroup[] = [];
  for (const [key, enterpriseRows] of byEnterprise) {
    const byCapability = new Map<string, AdminVersionRow[]>();
    for (const row of enterpriseRows) {
      const bucket = byCapability.get(row.capability.id);
      if (bucket) bucket.push(row);
      else byCapability.set(row.capability.id, [row]);
    }

    const capabilities: CapabilityGroup[] = [];
    for (const [capabilityId, capabilityRows] of byCapability) {
      const sorted = [...capabilityRows].sort(compareVersionDesc);
      capabilities.push({
        capabilityId,
        capabilityName: sorted[0].capability.name,
        latest: sorted[0],
        older: sorted.slice(1),
      });
    }
    // 最近动过的技能排前面：运营是来处理新变化的，不是来翻档案的
    capabilities.sort((a, b) => updatedAtDesc(a.latest, b.latest));

    groups.push({
      key,
      name: key === PLATFORM_GROUP_KEY ? '平台自建' : enterpriseRows[0].enterprise!.name,
      isPlatform: key === PLATFORM_GROUP_KEY,
      versionCount: enterpriseRows.length,
      capabilities,
    });
  }

  return groups.sort((a, b) => updatedAtDesc(a.capabilities[0].latest, b.capabilities[0].latest));
}
