import { describe, expect, it } from 'vitest';
import type { ContributionCapability } from '@/lib/types';
import { boardLane, buildPipeline, pipelineStepLabel, pipelineWaitLabel } from './pipeline-model';

const CONTRIBUTOR_ID = 'user_1';

function capability(overrides: Partial<ContributionCapability> = {}): ContributionCapability {
  return {
    id: 'cap_1',
    name: '研发周报洞察 Skill',
    description: '把研发团队的周报整理成结构化洞察',
    type: 'SKILL',
    industry: ['软件研发'],
    position: ['研发管理'],
    status: 'DRAFT',
    enterpriseId: 'ent_1',
    visibility: 'ENTERPRISE_PRIVATE',
    enterpriseReviewStatus: 'NOT_SUBMITTED',
    enterpriseReviewedById: null,
    enterpriseReviewedAt: null,
    enterpriseRejectionReason: null,
    platformReviewStatus: 'NOT_SUBMITTED',
    platformSubmittedById: null,
    platformSubmittedAt: null,
    platformRejectionReason: null,
    validationResult: null,
    validatedAt: null,
    usageCount: 0,
    rating: null,
    createdAt: '2026-08-25T06:41:44.000Z',
    updatedAt: '2026-08-25T09:05:12.000Z',
    contributor: { id: CONTRIBUTOR_ID, name: '甲总', email: 'boss@acme.local' },
    enterprise: { id: 'ent_1', name: '示例科技有限公司' },
    skillConfig: null,
    agentConfig: null,
    _count: { skillVersions: 1, bindings: 0 },
    ...overrides,
  } as ContributionCapability;
}

const asContributor = { hasEnterprise: true, isContributor: true, isEnterpriseAdmin: false };
const asAdmin = { hasEnterprise: true, isContributor: false, isEnterpriseAdmin: true };

describe('buildPipeline', () => {
  it('企业路径 6 步，个人路径 4 步', () => {
    expect(buildPipeline(capability(), asContributor).total).toBe(6);
    expect(
      buildPipeline(capability({ enterpriseId: null, enterprise: null }), {
        hasEnterprise: false,
        isContributor: true,
        isEnterpriseAdmin: false,
      }).total,
    ).toBe(4);
  });

  it('未校验时当前节点是自动校验，且不产生 CTA（球在系统手里）', () => {
    const model = buildPipeline(capability(), asContributor);
    expect(model.current.key).toBe('validate');
    expect(model.current.state).toBe('active');
    expect(model.ballInCourt).toBe(false);
    expect(model.current.actor.kind).toBe('system');
  });

  it('已校验未提交时，球在贡献者手里', () => {
    const model = buildPipeline(capability({ validatedAt: '2026-08-25T09:04:53.000Z' }), asContributor);
    expect(model.current.key).toBe('enterprise');
    expect(model.current.state).toBe('waiting');
    expect(model.ballInCourt).toBe(true);
    expect(model.current.ctas[0].action).toBe('submit-enterprise');
  });

  it('企业审核中：管理员拿到通过/驳回两个动作，贡献者拿不到', () => {
    const item = capability({ validatedAt: '2026-08-25T09:04:53.000Z', enterpriseReviewStatus: 'PENDING' });
    const admin = buildPipeline(item, asAdmin);
    expect(admin.current.key).toBe('enterprise');
    expect(admin.current.state).toBe('active');
    expect(admin.current.ctas.map((cta) => cta.action)).toEqual(['approve', 'reject']);

    const contributor = buildPipeline(item, asContributor);
    expect(contributor.ballInCourt).toBe(false);
    expect(pipelineWaitLabel(contributor)).toContain('企业管理员 处理中');
  });

  it('企业驳回：状态为 blocked，驳回原因随节点返回', () => {
    const model = buildPipeline(
      capability({
        validatedAt: '2026-08-25T09:04:53.000Z',
        enterpriseReviewStatus: 'REJECTED',
        enterpriseRejectionReason: '缺少边界条件说明',
      }),
      asContributor,
    );
    expect(model.current.state).toBe('blocked');
    expect(model.current.rejection).toBe('缺少边界条件说明');
    expect(model.current.ctas[0].label).toBe('修改后重新提交');
  });

  it('平台审核中：贡献者只能等待，不产生动作', () => {
    const model = buildPipeline(
      capability({
        validatedAt: '2026-08-25T09:04:53.000Z',
        enterpriseReviewStatus: 'APPROVED',
        platformReviewStatus: 'PENDING_REVIEW',
        platformSubmittedAt: '2026-08-25T09:05:12.000Z',
      }),
      asContributor,
    );
    expect(model.current.key).toBe('platform');
    expect(model.currentIndex).toBe(4);
    expect(model.ballInCourt).toBe(false);
    expect(pipelineStepLabel(model)).toBe('第 5/6 步 · 平台运营审核');
  });

  it('全部通过后每个节点都是 done', () => {
    const model = buildPipeline(
      capability({
        validatedAt: '2026-08-25T09:04:53.000Z',
        enterpriseReviewStatus: 'APPROVED',
        platformReviewStatus: 'APPROVED',
        visibility: 'MARKET_PUBLIC',
      }),
      asContributor,
    );
    expect(model.stages.every((stage) => stage.state === 'done')).toBe(true);
    expect(pipelineStepLabel(model)).toBe('已完成 6/6 步');
  });

  it('等待企业授权：球在管理员手里', () => {
    const item = capability({
      validatedAt: '2026-08-25T09:04:53.000Z',
      enterpriseReviewStatus: 'APPROVED',
      platformReviewStatus: 'REQUESTED',
    });
    expect(buildPipeline(item, asAdmin).current.ctas[0].action).toBe('authorize-platform');
    expect(buildPipeline(item, asContributor).ballInCourt).toBe(false);
  });

  it('个人路径下提交平台审核的球在贡献者手里', () => {
    const model = buildPipeline(capability({ enterpriseId: null, enterprise: null, validatedAt: '2026-08-25T09:04:53.000Z' }), {
      hasEnterprise: false,
      isContributor: true,
      isEnterpriseAdmin: false,
    });
    expect(model.current.key).toBe('platform');
    expect(model.current.ctas[0].action).toBe('request-platform');
    expect(pipelineStepLabel(model)).toBe('第 3/4 步 · 平台运营审核');
  });
});

describe('boardLane', () => {
  it('已校验但未提交的能力归入草稿列，而不是企业审核列', () => {
    const model = buildPipeline(capability({ validatedAt: '2026-08-25T09:04:53.000Z' }), asContributor);
    expect(model.current.key).toBe('enterprise');
    expect(boardLane(model)).toBe('draft');
  });

  it('企业审核中归入企业审核列', () => {
    const model = buildPipeline(
      capability({ validatedAt: '2026-08-25T09:04:53.000Z', enterpriseReviewStatus: 'PENDING' }),
      asAdmin,
    );
    expect(boardLane(model)).toBe('enterprise');
  });

  it('企业已通过待投稿归入投稿授权列', () => {
    const model = buildPipeline(
      capability({ validatedAt: '2026-08-25T09:04:53.000Z', enterpriseReviewStatus: 'APPROVED' }),
      asContributor,
    );
    expect(boardLane(model)).toBe('authorize');
  });

  it('已上架归入市场列', () => {
    const model = buildPipeline(
      capability({
        validatedAt: '2026-08-25T09:04:53.000Z',
        enterpriseReviewStatus: 'APPROVED',
        platformReviewStatus: 'APPROVED',
      }),
      asContributor,
    );
    expect(boardLane(model)).toBe('market');
  });
});
