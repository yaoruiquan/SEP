import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { createHash } from 'node:crypto';
import { Prisma, type SkillVersionStatus } from '@prisma/client';
import type { PersonalSkillReviewQuery, ReviewSkillVersionDto, SubmitPersonalSkillVersionDto } from 'shared';
import { PrismaService } from '../../prisma/prisma.service';
import { EnterpriseContextService, type EnterpriseContext } from '../enterprise/enterprise-context.service';

export const PERSONAL_SUBMISSION_SELECT = {
  id: true, capabilityId: true, parentVersionId: true, enterpriseId: true,
  ownerId: true, scope: true, version: true, status: true, changeSummary: true,
  submittedAt: true, enterpriseReviewedAt: true, rejectionReason: true,
  createdAt: true, updatedAt: true,
} as const;

@Injectable()
export class PersonalSkillSubmissionService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly context: EnterpriseContextService,
  ) {}

  private async assertGranted(ctx: EnterpriseContext, capabilityId: string) {
    const now = new Date();
    const subscription = await this.prisma.subscription.findFirst({
      where: {
        enterpriseId: ctx.enterpriseId, status: 'ACTIVE',
        OR: [{ endDate: null }, { endDate: { gt: now } }],
        employee: { bindings: { some: { capabilityId, capability: { type: 'SKILL' } } } },
        grants: { some: {
          OR: [{ memberId: ctx.memberId }, ...(ctx.departmentId ? [{ departmentId: ctx.departmentId }] : [])],
          AND: [{ OR: [{ expiresAt: null }, { expiresAt: { gt: now } }] }],
        } },
      },
      select: { id: true },
    });
    if (!subscription) throw new NotFoundException('技能不存在或没有有效授权');
  }

  async submit(userId: string, key: string, dto: SubmitPersonalSkillVersionDto) {
    const ctx = await this.context.resolve(userId);
    await this.assertGranted(ctx, dto.capabilityId);
    // A deterministic primary key makes retries atomic across processes without a separate request table.
    const digest = createHash('sha256').update(JSON.stringify([ctx.enterpriseId, userId, key])).digest('hex');
    const id = `psv_${digest}`;
    const select = { ...PERSONAL_SUBMISSION_SELECT, content: true } as const;
    const matches = (row: { capabilityId: string; parentVersionId: string | null; content: string; changeSummary: string | null }) => {
      if (row.capabilityId !== dto.capabilityId || row.parentVersionId !== dto.parentVersionId ||
          row.content !== dto.content || row.changeSummary !== (dto.changeSummary ?? null)) {
        throw new ConflictException('Idempotency-Key 已用于不同的保存内容，请为新保存生成新键');
      }
    };
    const existing = await this.prisma.skillVersion.findUnique({ where: { id }, select });
    if (existing) { matches(existing); return existing; }

    const parent = await this.prisma.skillVersion.findUnique({ where: { id: dto.parentVersionId } });
    if (!parent) throw new NotFoundException('来源版本不存在');
    const visible = (parent.scope === 'PLATFORM' && parent.status === 'PLATFORM_APPROVED') ||
      (parent.scope === 'ENTERPRISE' && parent.enterpriseId === ctx.enterpriseId && parent.status === 'ENTERPRISE_APPROVED') ||
      (parent.scope === 'PERSONAL' && parent.enterpriseId === ctx.enterpriseId && parent.ownerId === userId);
    if (!visible) throw new NotFoundException('来源版本不存在');
    if (parent.capabilityId !== dto.capabilityId) throw new BadRequestException('来源版本与技能不匹配');

    const created = await this.prisma.skillVersion.upsert({
      where: { id }, update: {},
      create: {
        id, capabilityId: dto.capabilityId, parentVersionId: parent.id,
        enterpriseId: ctx.enterpriseId, ownerId: userId, createdById: userId,
        scope: 'PERSONAL', status: 'PENDING_ENTERPRISE_REVIEW',
        version: `0.0.0-personal.${digest}`, content: dto.content,
        changeSummary: dto.changeSummary ?? null, submittedAt: new Date(),
      },
      select,
    }).catch(async (error: unknown) => {
      // Prisma may emulate an empty-update upsert; recover the winner of a concurrent insert.
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        const winner = await this.prisma.skillVersion.findUnique({ where: { id }, select });
        if (winner) return winner;
      }
      throw error;
    });
    matches(created);
    return created;
  }

  async list(userId: string, capabilityId: string, status?: SkillVersionStatus) {
    const ctx = await this.context.resolve(userId);
    await this.assertGranted(ctx, capabilityId);
    return this.prisma.skillVersion.findMany({
      where: { capabilityId, ...(status ? { status } : {}), OR: [
        { scope: 'PLATFORM', status: 'PLATFORM_APPROVED' },
        { scope: 'ENTERPRISE', enterpriseId: ctx.enterpriseId, status: 'ENTERPRISE_APPROVED' },
        { scope: 'PERSONAL', enterpriseId: ctx.enterpriseId, ownerId: userId },
      ] },
      select: PERSONAL_SUBMISSION_SELECT,
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
    });
  }

  async reviews(userId: string, query: PersonalSkillReviewQuery) {
    const ctx = await this.context.resolve(userId);
    this.context.assertEnterpriseAdmin(ctx);
    const where: Prisma.SkillVersionWhereInput = {
      enterpriseId: ctx.enterpriseId, scope: 'PERSONAL', submittedAt: { not: null },
      status: query.status, ...(query.capabilityId ? { capabilityId: query.capabilityId } : {}),
    };
    const [total, items] = await this.prisma.$transaction([
      this.prisma.skillVersion.count({ where }),
      this.prisma.skillVersion.findMany({ where, select: PERSONAL_SUBMISSION_SELECT,
        orderBy: [{ submittedAt: 'desc' }, { id: 'desc' }], skip: (query.page - 1) * query.limit, take: query.limit }),
    ]);
    return { total, items, page: query.page, limit: query.limit };
  }

  async review(userId: string, versionId: string, dto: ReviewSkillVersionDto) {
    const ctx = await this.context.resolve(userId);
    this.context.assertEnterpriseAdmin(ctx);
    return this.prisma.$transaction(async (tx) => {
      const version = await tx.skillVersion.findFirst({ where: {
        id: versionId, enterpriseId: ctx.enterpriseId, scope: 'PERSONAL', submittedAt: { not: null },
      } });
      if (!version) throw new NotFoundException('个人送审版本不存在');
      const updated = await tx.skillVersion.updateMany({
        where: { id: versionId, status: 'PENDING_ENTERPRISE_REVIEW' },
        data: {
          status: dto.decision === 'APPROVE' ? 'ENTERPRISE_APPROVED' : 'ENTERPRISE_REJECTED',
          enterpriseReviewedById: userId, enterpriseReviewedAt: new Date(),
          rejectionReason: dto.decision === 'REJECT' ? dto.comment : null,
        },
      });
      if (updated.count !== 1) throw new ConflictException('该版本已审核，不能重复审核');
      await tx.skillVersionReview.create({ data: {
        versionId, actorType: 'ENTERPRISE', decision: dto.decision, reviewerId: userId, comment: dto.comment,
      } });
      return tx.skillVersion.findUnique({ where: { id: versionId }, select: PERSONAL_SUBMISSION_SELECT });
    });
  }
}
