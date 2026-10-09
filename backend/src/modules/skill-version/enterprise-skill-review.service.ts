import { BadRequestException, ConflictException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { randomUUID } from 'node:crypto';
import type { ReviewSkillVersionDto } from 'shared';
import { PrismaService } from '../../prisma/prisma.service';
import { EnterpriseContextService } from '../enterprise/enterprise-context.service';
import { EnterpriseSkillDefaultService } from './enterprise-skill-default.service';
import { mergePersonalEdits } from './merge-personal-edits';
import { nextSemver } from './skill-version-numbering';

export const PERSONAL_REVIEW_RELATIONS = {
  enterpriseReviewedBy: { select: { id: true, name: true } },
  adoptedInto: { select: { targetVersionId: true, adoptedAt: true }, orderBy: { adoptedAt: 'desc' as const }, take: 1 },
  reviewSnapshots: {
    orderBy: { createdAt: 'desc' as const }, take: 1,
    select: {
      id: true, status: true, createdAt: true, workingCopyUpdatedAt: true, enterpriseReviewedAt: true, rejectionReason: true,
      enterpriseReviewedBy: { select: { id: true, name: true } },
      adoptedInto: { select: { targetVersionId: true, adoptedAt: true }, take: 1 },
    },
  },
} as const;

type ReviewStateSource = {
  status: string; updatedAt: Date; submittedAt?: Date | null;
  adoptedInto: Array<{ targetVersionId: string; adoptedAt: Date }>;
  reviewSnapshots: Array<{
    status: string; createdAt: Date; workingCopyUpdatedAt?: Date | null; enterpriseReviewedAt: Date | null; rejectionReason: string | null;
    enterpriseReviewedBy?: { id: string; name: string | null } | null;
    adoptedInto: Array<{ targetVersionId: string; adoptedAt: Date }>;
  }>;
  enterpriseReviewedAt?: Date | null; rejectionReason?: string | null;
  enterpriseReviewedBy?: { id: string; name: string | null } | null;
};

export function personalReviewState(row: ReviewStateSource) {
  const snapshot = row.reviewSnapshots?.[0];
  const adoption = row.adoptedInto?.[0];
  const isWorkingCopy = row.status === 'PERSONAL_ACTIVE';
  const reviewedWorkingCopy = isWorkingCopy && (
    (snapshot && (snapshot.workingCopyUpdatedAt
      ? snapshot.workingCopyUpdatedAt.getTime() === row.updatedAt.getTime()
      : snapshot.createdAt >= row.updatedAt)) || (!snapshot && adoption && adoption.adoptedAt >= row.updatedAt)
  );
  const reviewStatus = isWorkingCopy
    ? reviewedWorkingCopy ? snapshot?.status ?? 'ENTERPRISE_APPROVED' : 'PENDING_ENTERPRISE_REVIEW'
    : row.status;
  const publishedVersionId = isWorkingCopy && reviewedWorkingCopy
    ? snapshot?.adoptedInto?.[0]?.targetVersionId ?? adoption?.targetVersionId ?? null
    : !isWorkingCopy ? adoption?.targetVersionId ?? null : null;
  const isLegacyUnpublished = reviewStatus === 'ENTERPRISE_APPROVED' && !publishedVersionId;
  return {
    reviewStatus, publishedVersionId, isWorkingCopy, isLegacyUnpublished,
    pending: reviewStatus === 'PENDING_ENTERPRISE_REVIEW' || isLegacyUnpublished,
    enterpriseReviewedAt: reviewedWorkingCopy ? snapshot?.enterpriseReviewedAt ?? adoption?.adoptedAt : row.enterpriseReviewedAt ?? null,
    rejectionReason: reviewedWorkingCopy ? snapshot?.rejectionReason ?? null : row.rejectionReason ?? null,
    reviewedBy: reviewedWorkingCopy ? snapshot?.enterpriseReviewedBy ?? null : row.enterpriseReviewedBy ?? null,
  };
}

@Injectable()
export class EnterpriseSkillReviewService {
  private readonly logger = new Logger(EnterpriseSkillReviewService.name);
  constructor(
    private readonly prisma: PrismaService,
    private readonly context: EnterpriseContextService,
    private readonly defaults: EnterpriseSkillDefaultService,
  ) {}

  async review(userId: string, versionId: string, dto: ReviewSkillVersionDto) {
    const result = await this.reviewMany(userId, [versionId], dto, {
      [versionId]: dto.expectedUpdatedAt,
    });
    return { ...result.sources[0], publishedVersionId: result.version?.id ?? null,
      affectedSubscriptions: result.affectedSubscriptions };
  }

  async reviewMany(
    userId: string, ids: string[], dto: ReviewSkillVersionDto,
    expectedVersions: Record<string, string | undefined> = {}, capabilityId?: string, expectedMergedContent?: string,
  ) {
    const ctx = await this.context.resolve(userId);
    this.context.assertEnterpriseAdmin(ctx);
    if (new Set(ids).size !== ids.length || ids.length === 0) throw new BadRequestException('审核来源不能重复或为空');
    if (ids.length > 1 && !expectedMergedContent) throw new ConflictException('批量审核必须先确认最终合并正文，请逐条审核或提交预览正文');
    if (dto.decision === 'REJECT' && (!dto.comment?.trim() || ids.length !== 1)) {
      throw new BadRequestException('驳回单条改动时必须填写原因');
    }
    const result = await this.prisma.$transaction(async (tx) => {
      const first = await tx.skillVersion.findFirst({ where: {
        id: ids[0], scope: 'PERSONAL', enterpriseId: ctx.enterpriseId, workingCopyId: null, capability: { type: 'SKILL' },
      }, select: { capabilityId: true } });
      if (!first || (capabilityId && first.capabilityId !== capabilityId)) throw new NotFoundException('个人改动不存在');
      const skillId = first.capabilityId;
      await this.defaults.lock(tx, ctx.enterpriseId, skillId);
      // Lock editable copies as well as submissions so a concurrent save cannot change reviewed content.
      await tx.$queryRaw(Prisma.sql`SELECT id FROM skill_versions WHERE id IN (${Prisma.join([...ids].sort())}) ORDER BY id FOR UPDATE`);
      const sources = await tx.skillVersion.findMany({ where: {
        id: { in: ids }, capabilityId: skillId, enterpriseId: ctx.enterpriseId,
        scope: 'PERSONAL', workingCopyId: null,
      }, include: { ...PERSONAL_REVIEW_RELATIONS, owner: { select: { name: true } } }, orderBy: { updatedAt: 'asc' } });
      if (sources.length !== ids.length) throw new NotFoundException('部分改动不存在或不属于本企业');
      for (const source of sources) {
        const state = personalReviewState(source);
        if (!state.pending || (state.isLegacyUnpublished && dto.decision !== 'APPROVE')) {
          throw new ConflictException('该改动已审核，不能重复审核');
        }
        if (state.isWorkingCopy && (!expectedVersions[source.id] ||
            new Date(expectedVersions[source.id]!).getTime() !== source.updatedAt.getTime())) {
          throw new ConflictException('个人副本已更新或缺少预览依据，请重新查看内容后审核');
        }
      }
      const baseline = await this.defaults.get(ctx.enterpriseId, skillId, tx);
      const baselineVersion = baseline?.version ?? (sources.length > 1
        ? await tx.skillVersion.findFirst({ where: { capabilityId: skillId,
          scope: 'ENTERPRISE', enterpriseId: ctx.enterpriseId, status: 'ENTERPRISE_APPROVED' },
          orderBy: { createdAt: 'desc' } }) ?? await tx.skillVersion.findFirst({
          where: { capabilityId: skillId, scope: 'PLATFORM', status: 'PLATFORM_APPROVED' },
          orderBy: { createdAt: 'desc' } }) : null);
      const merged = sources.length === 1 ? { content: sources[0].content, conflicts: [] } : mergePersonalEdits(
        baselineVersion?.content ?? sources[0].content,
        sources.map((source) => ({ label: source.owner?.name ?? '成员', content: source.content })),
      );
      if (merged.conflicts.length) throw new ConflictException('多人改动存在合并冲突，请逐条审核或解决冲突后重新提交');
      if (sources.length > 1 && merged.content !== expectedMergedContent) {
        throw new ConflictException('最终合并正文与预览不一致，请重新预览或逐条审核');
      }
      const now = new Date();
      const status = dto.decision === 'APPROVE' ? 'ENTERPRISE_APPROVED' : 'ENTERPRISE_REJECTED';
      const snapshots = [];
      for (const source of sources) {
        const reviewed = source.status === 'PERSONAL_ACTIVE'
          ? await tx.skillVersion.create({ data: {
            capabilityId: skillId, enterpriseId: ctx.enterpriseId, scope: 'PERSONAL', ownerId: source.ownerId,
            workingCopyId: source.id, workingCopyUpdatedAt: source.updatedAt,
            parentVersionId: source.parentVersionId, version: source.version,
            content: source.content, changeSummary: source.changeSummary, createdById: source.createdById,
            packageKey: source.packageKey, packageSha256: source.packageSha256,
            packageFilename: source.packageFilename, packageFileCount: source.packageFileCount,
            submittedAt: now, status, enterpriseReviewedById: userId, enterpriseReviewedAt: now,
            rejectionReason: dto.decision === 'REJECT' ? dto.comment : null,
          } })
          : await tx.skillVersion.update({ where: { id: source.id }, data: {
            status, enterpriseReviewedById: userId, enterpriseReviewedAt: now,
            rejectionReason: dto.decision === 'REJECT' ? dto.comment : null,
          } });
        await tx.skillVersionReview.create({ data: {
          versionId: reviewed.id, actorType: 'ENTERPRISE', decision: dto.decision,
          reviewerId: userId, comment: dto.comment ?? (source.status === 'ENTERPRISE_APPROVED' ? '历史已通过个人版本发布为企业版' : null),
        } });
        snapshots.push(reviewed);
      }
      let version = null;
      let affectedSubscriptions = 0;
      const batchId = ids.length > 1 ? randomUUID() : null;
      if (dto.decision === 'APPROVE') {
        const existing = await tx.skillVersion.findMany({ where: {
          capabilityId: skillId, enterpriseId: ctx.enterpriseId, scope: 'ENTERPRISE',
        }, select: { version: true } });
        version = await tx.skillVersion.create({ data: {
          capabilityId: skillId, enterpriseId: ctx.enterpriseId, scope: 'ENTERPRISE', status: 'ENTERPRISE_APPROVED',
          parentVersionId: baselineVersion?.id ?? sources[0].parentVersionId,
          version: nextSemver(existing.map((row) => row.version)), content: merged.content,
          changeSummary: sources.map((row) => row.changeSummary ?? `审核 ${row.owner?.name ?? '成员'} 的改动`).join('；'),
          createdById: userId, enterpriseReviewedById: userId, enterpriseReviewedAt: now,
          ...(sources.length === 1 ? { packageKey: sources[0].packageKey, packageSha256: sources[0].packageSha256,
            packageFileCount: sources[0].packageFileCount, packageFilename: sources[0].packageFilename } : {}),
        } });
        await tx.skillVersionAdoption.createMany({ data: snapshots.map((source) => ({
          sourceVersionId: source.id, targetVersionId: version!.id, adoptedById: userId, batchId,
        })) });
        ({ affectedSubscriptions } = await this.defaults.set(tx, ctx.enterpriseId, skillId, version.id, userId));
      }
      return { version, affectedSubscriptions, batchId, sources: sources.map((source, index) => ({
        id: source.id, capabilityId: source.capabilityId, enterpriseId: source.enterpriseId,
        ownerId: source.ownerId, scope: source.scope, status: snapshots[index].status,
        version: source.version, changeSummary: source.changeSummary,
        parentVersionId: source.parentVersionId, createdAt: source.createdAt, updatedAt: snapshots[index].updatedAt,
        submittedAt: snapshots[index].submittedAt, enterpriseReviewedAt: now,
        rejectionReason: snapshots[index].rejectionReason,
      })) };
    }, { timeout: 15_000 });
    if (result.version) await this.notify(ctx.enterpriseId, result.version.capabilityId, result.version.version);
    return result;
  }

  private async notify(enterpriseId: string, capabilityId: string, version: string) {
    try {
      const members = await this.prisma.enterpriseMember.findMany({ where: { enterpriseId }, select: { userId: true } });
      if (members.length) await this.prisma.notification.createMany({ data: members.map(({ userId }) => ({
        userId, type: 'SKILL_VERSION_UPDATED', category: 'SYSTEM', severity: 'INFO', title: '技能企业版本已更新',
        message: `技能已审核发布为企业版本 ${version}，已明确选版的成员不受默认变化影响。`,
        relatedType: 'capability', relatedId: capabilityId,
      })) });
    } catch (error) { this.logger.warn(`技能发布通知失败: ${error instanceof Error ? error.message : 'unknown'}`); }
  }
}
