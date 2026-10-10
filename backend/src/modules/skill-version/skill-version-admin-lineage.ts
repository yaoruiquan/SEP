import { Prisma } from '@prisma/client';
import { isPlatformWorkingCopy } from './promote-to-platform';

const userSelect = { id: true, name: true } as const;
const adoptionSelect = {
  adoptedAt: true,
  adoptedBy: { select: userSelect },
  targetVersion: { select: {
    id: true, scope: true, version: true,
    enterpriseReviewedBy: { select: userSelect },
    _count: { select: { enterpriseDefaults: true } },
  } },
} as const;
const snapshotSelect = {
  id: true, status: true, createdAt: true, workingCopyUpdatedAt: true, enterpriseReviewedAt: true,
  enterpriseReviewedBy: { select: userSelect },
  adoptedInto: { select: adoptionSelect, orderBy: { adoptedAt: 'desc' as const } },
  reviews: { where: { actorType: 'ENTERPRISE' as const }, select: { id: true }, take: 1 },
  promotedVersions: { select: { id: true }, take: 1 },
} as const;
const lineageSelect = {
  id: true, scope: true, status: true, version: true, updatedAt: true, createdAt: true,
  sourceVersionId: true, workingCopyId: true, workingCopyUpdatedAt: true, submittedAt: true,
  createdBy: { select: userSelect },
  enterpriseReviewedBy: { select: userSelect },
  _count: { select: { enterpriseDefaults: true } },
  adoptedSources: { select: {
    adoptedBy: { select: userSelect },
    sourceVersion: { select: { createdBy: { select: userSelect } } },
  }, orderBy: { adoptedAt: 'desc' as const } },
  adoptedInto: { select: adoptionSelect, orderBy: { adoptedAt: 'desc' as const } },
  reviewSnapshots: {
    where: { status: { in: ['ENTERPRISE_APPROVED', 'ENTERPRISE_REJECTED'] as Array<'ENTERPRISE_APPROVED' | 'ENTERPRISE_REJECTED'> } },
    select: snapshotSelect, orderBy: [{ createdAt: 'desc' as const }, { id: 'desc' as const }],
  },
} satisfies Prisma.SkillVersionSelect;

const adminLineageSelect = {
  ...lineageSelect,
  workingCopy: { select: lineageSelect },
  sourceVersion: { select: { ...lineageSelect, workingCopy: { select: lineageSelect } } },
} satisfies Prisma.SkillVersionSelect;

type LineageVersion = Prisma.SkillVersionGetPayload<{ select: typeof adminLineageSelect }>;
type Person = { id: string; name: string | null };
export type AdminVersionLineage = {
  originalSubmitters: Person[];
  enterprisePublisher: Person | null;
  enterprisePublishedVersions: Array<{ id: string; version: string; isEnterpriseCurrent: boolean }>;
};

function emptyLineage(): AdminVersionLineage {
  return { originalSubmitters: [], enterprisePublisher: null, enterprisePublishedVersions: [] };
}

function lineageFor(version: LineageVersion): AdminVersionLineage {
  const result = emptyLineage();
  if (version.scope === 'ENTERPRISE') {
    result.originalSubmitters = [...new Map(version.adoptedSources.map((adoption) => {
      const author = adoption.sourceVersion.createdBy;
      return [author.id, author] as const;
    })).values()];
    result.enterprisePublisher = version.enterpriseReviewedBy ?? version.adoptedSources[0]?.adoptedBy ?? null;
    result.enterprisePublishedVersions = [{ id: version.id, version: version.version,
      isEnterpriseCurrent: version._count.enterpriseDefaults > 0 }];
    return result;
  }
  if (version.scope === 'PLATFORM') {
    // A missing historical relation is not evidence that the platform operator authored it.
    if (!version.sourceVersionId) result.originalSubmitters = [version.createdBy];
    return result;
  }
  result.originalSubmitters = [version.createdBy];
  let reviewed = version as Pick<LineageVersion, 'enterpriseReviewedBy' | 'adoptedInto'> | undefined;
  if (isPlatformWorkingCopy(version) || version.status === 'PERSONAL_ACTIVE' ||
      (version.workingCopyId && version.status === 'DRAFT' && !version.submittedAt)) {
    const revision = version.workingCopyUpdatedAt ?? version.updatedAt;
    const origin = version.workingCopyId ? version.workingCopy : version;
    const snapshots = origin?.reviewSnapshots.filter((candidate) =>
      (!version.workingCopyId || candidate.createdAt <= version.createdAt) &&
      (candidate.reviews.length > 0 || candidate.adoptedInto.length > 0 ||
        (candidate.enterpriseReviewedAt && candidate.enterpriseReviewedBy && !candidate.promotedVersions.length))) ?? [];
    const snapshot = snapshots.find((candidate) => candidate.workingCopyUpdatedAt
      ? candidate.workingCopyUpdatedAt.getTime() === revision.getTime()
      : candidate.createdAt >= revision);
    reviewed = snapshot;
    // Old adoptions without snapshots remain usable only for this revision, never after an edit.
    if (!snapshot && snapshots.length === 0) {
      const adoptedInto = origin?.adoptedInto.filter((adoption) => adoption.adoptedAt >= revision &&
        (!version.workingCopyId || adoption.adoptedAt <= version.createdAt)) ?? [];
      reviewed = { enterpriseReviewedBy: null, adoptedInto };
    }
  }
  result.enterprisePublisher = reviewed?.enterpriseReviewedBy ?? reviewed?.adoptedInto[0]?.targetVersion.enterpriseReviewedBy ??
    reviewed?.adoptedInto[0]?.adoptedBy ?? null;
  result.enterprisePublishedVersions = [...new Map((reviewed?.adoptedInto ?? [])
    .filter((adoption) => adoption.targetVersion.scope === 'ENTERPRISE')
    .map(({ targetVersion }) => [targetVersion.id, { id: targetVersion.id, version: targetVersion.version,
      isEnterpriseCurrent: targetVersion._count.enterpriseDefaults > 0 }] as const)).values()];
  return result;
}

/** Batch by frontier, not by result row; list and detail share exactly the same projection. */
export async function readAdminVersionLineages(tx: Prisma.TransactionClient, ids: string[]) {
  const versions = new Map<string, LineageVersion>();
  const queried = new Set<string>();
  let pending = [...new Set(ids)];
  while (pending.length) {
    pending.forEach((id) => queried.add(id));
    const rows = await tx.skillVersion.findMany({ where: { id: { in: pending } }, select: adminLineageSelect });
    pending = [];
    for (const row of rows) {
      versions.set(row.id, row);
      if (row.sourceVersion) versions.set(row.sourceVersion.id, { ...row.sourceVersion, sourceVersion: null });
    }
    for (const row of versions.values()) {
      if (row.scope === 'PLATFORM' && row.sourceVersionId && !versions.has(row.sourceVersionId) && !queried.has(row.sourceVersionId)) {
        pending.push(row.sourceVersionId);
      }
    }
    pending = [...new Set(pending)];
  }
  const resolve = (id: string): AdminVersionLineage => {
    const visited = new Set<string>();
    let version = versions.get(id);
    while (version?.scope === 'PLATFORM' && version.sourceVersionId) {
      if (visited.has(version.id)) return emptyLineage();
      visited.add(version.id);
      version = versions.get(version.sourceVersionId);
    }
    return version ? lineageFor(version) : emptyLineage();
  };
  return new Map(ids.map((id) => [id, resolve(id)]));
}
