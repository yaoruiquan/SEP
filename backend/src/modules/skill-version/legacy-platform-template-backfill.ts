import { BadRequestException, ConflictException, ForbiddenException } from '@nestjs/common';
import { createHash } from 'node:crypto';
import { z } from 'zod';
import { PrismaService } from '../../prisma/prisma.service';
import { prepareSkillMarkdown } from '../../shared/skill-content';
import { SkillVersionService } from './skill-version.service';
import { CapabilityValidatorService } from '../capability-contribution/capability-validator.service';

export const LegacyTemplateReviewSchema = z.array(z.object({
  capabilityId: z.string().min(1),
  sourceSha256: z.string().regex(/^[0-9a-f]{64}$/),
  reviewSummary: z.string().trim().min(1),
  executionBoundary: z.string().trim().min(1),
  reviewedContent: z.string().trim().min(1).optional(),
}).strict()).min(1).refine((rows) => new Set(rows.map((row) => row.capabilityId)).size === rows.length,
  '审阅清单不得重复能力');
export type LegacyTemplateReview = z.infer<typeof LegacyTemplateReviewSchema>[number];
const hash = (content: string) => createHash('sha256').update(content).digest('hex');
const marker = 'legacy-template-reviewed-v1';

export async function backfillLegacyPlatformTemplates(
  prisma: PrismaService,
  versions: SkillVersionService,
  reviews: LegacyTemplateReview[],
  options: { apply?: boolean; reviewerId?: string } = {},
) {
  LegacyTemplateReviewSchema.parse(reviews);
  if (options.apply) {
    const reviewer = options.reviewerId && await prisma.user.findUnique({
      where: { id: options.reviewerId }, select: { role: true, status: true },
    });
    if (!reviewer || reviewer.role !== 'ADMIN' || reviewer.status !== 'ACTIVE') {
      throw new ForbiddenException('应用补版必须指定现有且启用的平台管理员');
    }
  }

  // Preflight every reviewed item before creating any version; never approve arbitrary templates in bulk.
  const plans = [];
  for (const review of reviews) {
    const capability = await prisma.capability.findUnique({ where: { id: review.capabilityId }, include: {
      skillConfig: true, skillVersions: { orderBy: [{ createdAt: 'asc' }, { id: 'asc' }] },
    } });
    if (!capability || capability.type !== 'SKILL' || capability.enterpriseId || capability.status !== 'APPROVED') {
      throw new BadRequestException(`能力不属于可补版的历史平台 Skill：${review.capabilityId}`);
    }
    const approved = capability.skillVersions.find((row) => row.scope === 'PLATFORM' && row.status === 'PLATFORM_APPROVED');
    if (approved) {
      plans.push({ review, capability, approved, content: null, pending: null });
      continue;
    }
    const original = capability.skillConfig?.template;
    if (!original || hash(original) !== review.sourceSha256) {
      throw new ConflictException(`模板已变化或缺失，请重新审阅：${capability.name}`);
    }
    const content = `# 执行边界（优先于下方历史示例）\n\n${review.executionBoundary}\n\n${review.reviewedContent ?? original}`;
    const changeSummary = `${marker}; source-sha256=${review.sourceSha256}; ${review.reviewSummary}`;
    if (changeSummary.length > 2000) throw new BadRequestException('审阅摘要过长');
    const pending = capability.skillVersions.find((row) => row.scope === 'PLATFORM' &&
      row.status === 'PENDING_PLATFORM_REVIEW' && row.content === content && row.changeSummary === changeSummary);
    if (capability.skillVersions.length && (!pending || capability.skillVersions.length !== 1)) {
      throw new ConflictException(`能力已有其他版本，请人工选择来源：${capability.name}`);
    }
    const prepared = prepareSkillMarkdown(content, 'sep-legacy-preflight');
    if (prepared.status === 'BLOCKED') throw new BadRequestException(`模板不可安装：${capability.name} (${prepared.reason})`);
    const validation = new CapabilityValidatorService().validateSkill(prepared.body);
    if (!validation.valid) throw new BadRequestException(`模板正文检查未通过：${capability.name}`);
    plans.push({ review, capability, approved: null, content, pending, changeSummary });
  }

  const results = [];
  for (const plan of plans) {
    const identity = { capabilityId: plan.capability.id, name: plan.capability.name,
      sourceSha256: plan.review.sourceSha256, reviewSummary: plan.review.reviewSummary };
    if (plan.approved) {
      results.push({ ...identity, status: 'ALREADY_APPROVED', versionId: plan.approved.id });
    } else if (!options.apply) {
      results.push({ ...identity, status: 'READY', approvedContentSha256: hash(plan.content),
        resumableVersionId: plan.pending?.id ?? null });
    } else {
      const draft = plan.pending ?? await versions.createPlatformVersion(options.reviewerId, plan.capability.id, {
        content: plan.content, changeSummary: plan.changeSummary,
      }, { expectedTemplateSha256: plan.review.sourceSha256 });
      const published = await versions.publishPlatformVersion(options.reviewerId, draft.id, {
        expectedUpdatedAt: draft.updatedAt.toISOString(), expectedPlatformVersionId: null,
        changeSummary: plan.changeSummary,
      });
      results.push({ ...identity, status: 'PUBLISHED', versionId: published.id,
        version: published.version, approvedContentSha256: hash(published.content) });
    }
  }
  return results;
}
