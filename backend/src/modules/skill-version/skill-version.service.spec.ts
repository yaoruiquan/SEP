import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import { SkillVersionService } from './skill-version.service';
import { PrismaService } from '../../prisma/prisma.service';
import { EnterpriseContextService } from '../enterprise/enterprise-context.service';

const memberContext = {
  enterpriseId: 'enterprise-1',
  memberId: 'member-1',
  departmentId: 'department-1',
  role: 'MEMBER' as const,
};

const adminContext = { ...memberContext, role: 'ENTERPRISE_ADMIN' as const };

const platformVersion = {
  id: 'version-platform',
  capabilityId: 'capability-1',
  scope: 'PLATFORM',
  enterpriseId: null,
  parentVersionId: null,
  sourceVersionId: null,
  version: '1.0.0',
  content: '# Approved skill',
  changeSummary: null,
  status: 'PLATFORM_APPROVED',
  createdAt: new Date(),
  updatedAt: new Date(),
  capability: { id: 'capability-1', name: 'Skill', description: 'Description' },
};

function createPrismaMock() {
  const prisma = {
    skillVersion: {
      findUnique: jest.fn(),
      findFirst: jest.fn(),
      findMany: jest.fn(),
      count: jest.fn().mockResolvedValue(0),
      create: jest.fn(),
      update: jest.fn(),
      updateMany: jest.fn().mockResolvedValue({ count: 1 }),
    },
    skillVersionReview: { create: jest.fn() },
    subscription: {
      findFirst: jest.fn(),
      findUnique: jest.fn().mockResolvedValue({ enterpriseId: 'enterprise-1', employee: { bindings: [] } }),
      findMany: jest.fn().mockResolvedValue([]),
    },
    capability: { findUnique: jest.fn().mockResolvedValue({ name: '测试能力' }) },
    enterpriseMember: { findMany: jest.fn().mockResolvedValue([]) },
    notification: { createMany: jest.fn() },
    employeeCapabilityBinding: {
      findFirst: jest.fn(),
      // 「发布为平台版」要把员工模板钉着的默认版推到新版本，否则那个动作没有任何效果
      updateMany: jest.fn().mockResolvedValue({ count: 0 }),
    },
    memberSkillVersionSelection: { findFirst: jest.fn().mockResolvedValue(null) },
    subscriptionSkillVersion: {
      findUnique: jest.fn(),
      upsert: jest.fn(),
    },
    enterpriseSkillDefault: { findUnique: jest.fn().mockResolvedValue(null), findMany: jest.fn().mockResolvedValue([]) },
    $transaction: jest.fn(),
  };
  prisma.$transaction.mockImplementation((callback: (tx: typeof prisma) => unknown) => callback(prisma));
  return prisma;
}

describe('SkillVersionService', () => {
  let prisma: ReturnType<typeof createPrismaMock>;
  let enterpriseContext: {
    resolve: jest.Mock;
    assertCanApprove: jest.Mock;
    assertEnterpriseAdmin: jest.Mock;
  };
  let service: SkillVersionService;
  let defaults: { get: jest.Mock; lock: jest.Mock; set: jest.Mock };

  beforeEach(() => {
    prisma = createPrismaMock();
    enterpriseContext = {
      resolve: jest.fn().mockResolvedValue(memberContext),
      assertCanApprove: jest.fn(),
      assertEnterpriseAdmin: jest.fn((ctx) => {
        if (ctx.role !== 'ENTERPRISE_ADMIN') throw new ForbiddenException('仅企业管理员可执行此操作');
      }),
    };
    defaults = { get: jest.fn().mockResolvedValue(null), lock: jest.fn().mockResolvedValue(undefined),
      set: jest.fn().mockResolvedValue({ affectedSubscriptions: 0 }) };
    service = new SkillVersionService(
      prisma as unknown as PrismaService,
      enterpriseContext as unknown as EnterpriseContextService,
      defaults as never,
    );
  });

  it('denies preview when the member has no active granted subscription', async () => {
    prisma.skillVersion.findUnique.mockResolvedValue(platformVersion);
    prisma.subscription.findFirst.mockResolvedValue(null);

    await expect(service.previewEnterpriseVersion('user-1', platformVersion.id)).rejects.toThrow(
      ForbiddenException,
    );
  });

  it('returns personal submission Markdown byte-for-byte, including frontmatter and CRLF', async () => {
    const content = '---\r\nname: client-skill\r\n---\r\n\r\n# Content\r\n';
    prisma.skillVersion.findUnique.mockResolvedValue({
      ...platformVersion, scope: 'PERSONAL', ownerId: 'user-1',
      enterpriseId: memberContext.enterpriseId, status: 'ENTERPRISE_REJECTED', content,
    });
    prisma.subscription.findFirst.mockResolvedValue({ id: 'subscription-1' });
    const result = await service.previewEnterpriseVersion('user-1', 'personal-version');
    expect(result.content).toBe(content);
    expect(prisma.subscription.findFirst).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ OR: [{ endDate: null }, { endDate: { gt: expect.any(Date) } }] }),
    }));
  });

  it.each([
    { ownerId: 'other-user', enterpriseId: memberContext.enterpriseId },
    { ownerId: 'user-1', enterpriseId: 'other-enterprise' },
  ])('hides personal content outside ownership and tenant boundaries: %j', async (ownership) => {
    prisma.skillVersion.findUnique.mockResolvedValue({
      ...platformVersion, ...ownership, scope: 'PERSONAL', status: 'PENDING_ENTERPRISE_REVIEW',
      submittedAt: new Date(),
    });
    await expect(service.previewEnterpriseVersion('user-1', 'personal-version')).rejects.toThrow(NotFoundException);
    expect(prisma.subscription.findFirst).not.toHaveBeenCalled();
  });

  it('lets an administrator read a submitted review without an employee grant', async () => {
    enterpriseContext.resolve.mockResolvedValue(adminContext);
    const pending = { ...platformVersion, scope: 'PERSONAL', ownerId: 'other-user',
      enterpriseId: memberContext.enterpriseId, status: 'PENDING_ENTERPRISE_REVIEW', submittedAt: new Date() };
    prisma.skillVersion.findUnique.mockResolvedValue(pending);
    await expect(service.previewEnterpriseVersion('admin', 'personal-version')).resolves.toEqual(pending);
    expect(prisma.subscription.findFirst).not.toHaveBeenCalled();
  });

  it('includes own pending submissions without selecting them as the current published version', async () => {
    prisma.subscription.findFirst.mockResolvedValue({ id: 'sub-1' });
    Object.assign(prisma.employeeCapabilityBinding, { findMany: jest.fn().mockResolvedValue([
      { capability: platformVersion.capability, defaultSkillVersion: platformVersion },
    ]) });
    Object.assign(prisma.subscriptionSkillVersion, { findMany: jest.fn().mockResolvedValue([]) });
    const pending = { ...platformVersion, id: 'pending', scope: 'PERSONAL', status: 'PENDING_ENTERPRISE_REVIEW' };
    prisma.skillVersion.findMany.mockResolvedValue([pending, platformVersion]);
    prisma.skillVersion.findFirst.mockResolvedValue(platformVersion);
    const result = await service.listEmployeeSkills('user-1', 'employee-1');
    expect(result.skills[0].currentVersion.id).toBe(platformVersion.id);
    expect(result.skills[0].currentVersion).not.toHaveProperty('content');
    expect(result.skills[0].versions).toContain(pending);
    expect(result.skills[0].latestPublishedVersion.id).toBe(platformVersion.id);
    expect(prisma.skillVersion.findMany.mock.calls[0][0].where.OR).toContainEqual({
      scope: 'PERSONAL', enterpriseId: memberContext.enterpriseId, ownerId: 'user-1',
    });
  });

  it('hides another enterprise private version', async () => {
    prisma.skillVersion.findUnique.mockResolvedValue({
      ...platformVersion,
      scope: 'ENTERPRISE',
      enterpriseId: 'enterprise-2',
      status: 'ENTERPRISE_APPROVED',
    });

    await expect(service.previewEnterpriseVersion('user-1', 'private-version')).rejects.toThrow(
      NotFoundException,
    );
    expect(prisma.subscription.findFirst).not.toHaveBeenCalled();
  });

  it('hides a platform version before platform approval', async () => {
    prisma.skillVersion.findUnique.mockResolvedValue({
      ...platformVersion,
      status: 'PENDING_PLATFORM_REVIEW',
    });

    await expect(service.previewEnterpriseVersion('user-1', 'pending-version')).rejects.toThrow(
      NotFoundException,
    );
  });

  it('does not allow an ordinary member to publish an enterprise version', async () => {
    enterpriseContext.assertEnterpriseAdmin.mockImplementation(() => {
      throw new ForbiddenException('仅企业管理员可执行此操作');
    });

    await expect(service.publishEnterpriseVersion('user-1', 'version-1')).rejects.toThrow(
      ForbiddenException,
    );
    expect(prisma.skillVersion.findFirst).not.toHaveBeenCalled();
  });

  it('does not allow selecting an unapproved version', async () => {
    enterpriseContext.resolve.mockResolvedValue(adminContext);
    prisma.subscription.findFirst.mockResolvedValue({
      id: 'subscription-1',
      employeeId: 'employee-1',
      enterpriseId: 'enterprise-1',
    });
    prisma.employeeCapabilityBinding.findFirst.mockResolvedValue({ id: 'binding-1' });
    prisma.skillVersion.findUnique.mockResolvedValue({
      ...platformVersion,
      status: 'PENDING_PLATFORM_REVIEW',
    });

    await expect(
      service.selectVersion(
        'admin-1',
        'subscription-1',
        'capability-1',
        platformVersion.id,
      ),
    ).rejects.toThrow(BadRequestException);
    expect(prisma.subscriptionSkillVersion.upsert).not.toHaveBeenCalled();
    expect(defaults.lock).not.toHaveBeenCalled();
    expect(defaults.set).not.toHaveBeenCalled();
  });

  it('switches the enterprise default through the shared service without changing member preferences', async () => {
    enterpriseContext.resolve.mockResolvedValue(adminContext);
    prisma.subscription.findFirst.mockResolvedValue({
      id: 'subscription-1', employeeId: 'employee-1', enterpriseId: 'enterprise-1',
    });
    prisma.employeeCapabilityBinding.findFirst.mockResolvedValue({ id: 'binding-1' });
    prisma.skillVersion.findUnique.mockResolvedValue(platformVersion);
    await service.selectVersion('admin-1', 'subscription-1', 'capability-1', platformVersion.id);
    expect(defaults.lock).toHaveBeenCalledWith(prisma, 'enterprise-1', 'capability-1');
    expect(defaults.set).toHaveBeenCalledWith(prisma, 'enterprise-1', 'capability-1', platformVersion.id, 'admin-1');
    expect(defaults.lock.mock.invocationCallOrder[0]).toBeLessThan(defaults.set.mock.invocationCallOrder[0]);
    expect(prisma.subscriptionSkillVersion.upsert).not.toHaveBeenCalled();
    expect(prisma.memberSkillVersionSelection.findFirst).not.toHaveBeenCalled();
  });

  it.each([
    { scope: 'PERSONAL', enterpriseId: 'enterprise-1', ownerId: 'admin-1', status: 'ENTERPRISE_APPROVED' },
    { scope: 'ENTERPRISE', enterpriseId: 'other-enterprise', status: 'ENTERPRISE_APPROVED' },
    { scope: 'ENTERPRISE', enterpriseId: 'enterprise-1', status: 'ENTERPRISE_REJECTED' },
  ])('cannot make a personal, foreign or unpublished version the enterprise default: %j', async (version) => {
    enterpriseContext.resolve.mockResolvedValue(adminContext);
    prisma.subscription.findFirst.mockResolvedValue({
      id: 'subscription-1', employeeId: 'employee-1', enterpriseId: 'enterprise-1',
    });
    prisma.employeeCapabilityBinding.findFirst.mockResolvedValue({ id: 'binding-1' });
    prisma.skillVersion.findUnique.mockResolvedValue({ ...platformVersion, ...version });
    await expect(service.selectVersion('admin-1', 'subscription-1', 'capability-1', platformVersion.id))
      .rejects.toThrow(BadRequestException);
    expect(defaults.set).not.toHaveBeenCalled();
  });

  describe('setEnterpriseDefault', () => {
    it('denies ordinary members before checking capability visibility or writing defaults', async () => {
      await expect(service.setEnterpriseDefault('user-1', 'capability-1', platformVersion.id))
        .rejects.toThrow(ForbiddenException);
      expect(enterpriseContext.assertEnterpriseAdmin).toHaveBeenCalledWith(memberContext);
      expect(prisma.subscription.findFirst).not.toHaveBeenCalled();
      expect(prisma.skillVersion.findUnique).not.toHaveBeenCalled();
      expect(defaults.lock).not.toHaveBeenCalled();
      expect(defaults.set).not.toHaveBeenCalled();
    });

    it('allows an administrator to roll back a retained enterprise skill without a subscription', async () => {
      enterpriseContext.resolve.mockResolvedValue(adminContext);
      prisma.subscription.findFirst.mockResolvedValue(null);
      prisma.skillVersion.findFirst.mockResolvedValue({ id: 'enterprise-new' });
      const oldVersion = { ...platformVersion, id: 'enterprise-old', scope: 'ENTERPRISE',
        enterpriseId: 'enterprise-1', status: 'ENTERPRISE_APPROVED', version: '1.0.0' };
      prisma.skillVersion.findUnique.mockResolvedValue(oldVersion);

      await expect(service.setEnterpriseDefault('admin-1', 'capability-1', oldVersion.id))
        .resolves.toEqual({ capabilityId: 'capability-1', versionId: oldVersion.id, version: oldVersion });

      expect(prisma.skillVersion.findFirst).toHaveBeenCalledWith(expect.objectContaining({ where: {
        enterpriseId: 'enterprise-1', capabilityId: 'capability-1', capability: { type: 'SKILL' }, OR: [
          { scope: 'ENTERPRISE', status: 'ENTERPRISE_APPROVED' },
          { scope: 'PERSONAL', workingCopyId: null,
            status: { in: ['PERSONAL_ACTIVE', 'PENDING_ENTERPRISE_REVIEW', 'ENTERPRISE_APPROVED', 'ENTERPRISE_REJECTED'] } },
        ],
      } }));
      expect(defaults.lock).toHaveBeenCalledWith(prisma, 'enterprise-1', 'capability-1');
      expect(defaults.set).toHaveBeenCalledWith(prisma, 'enterprise-1', 'capability-1', oldVersion.id, 'admin-1');
      expect(defaults.lock.mock.invocationCallOrder[0]).toBeLessThan(defaults.set.mock.invocationCallOrder[0]);
      expect(prisma.subscriptionSkillVersion.upsert).not.toHaveBeenCalled();
      expect(prisma.memberSkillVersionSelection.findFirst).not.toHaveBeenCalled();
      expect(prisma.skillVersion.update).not.toHaveBeenCalled();
    });

    it('hides capabilities that have neither an active enterprise binding nor retained versions', async () => {
      enterpriseContext.resolve.mockResolvedValue(adminContext);
      prisma.subscription.findFirst.mockResolvedValue(null);
      prisma.skillVersion.findFirst.mockResolvedValue(null);
      await expect(service.setEnterpriseDefault('admin-1', 'capability-1', platformVersion.id))
        .rejects.toThrow(NotFoundException);
      expect(prisma.skillVersion.findUnique).not.toHaveBeenCalled();
      expect(defaults.set).not.toHaveBeenCalled();
    });

    it.each([
      { scope: 'PERSONAL', enterpriseId: 'enterprise-1', ownerId: 'admin-1', status: 'ENTERPRISE_APPROVED' },
      { scope: 'ENTERPRISE', enterpriseId: 'other-enterprise', status: 'ENTERPRISE_APPROVED' },
      { scope: 'ENTERPRISE', enterpriseId: 'enterprise-1', status: 'DRAFT' },
      { scope: 'PLATFORM', status: 'PENDING_PLATFORM_REVIEW' },
      { capabilityId: 'other-capability' },
    ])('rejects invalid global default selections without taking the write lock: %j', async (version) => {
      enterpriseContext.resolve.mockResolvedValue(adminContext);
      prisma.subscription.findFirst.mockResolvedValue({ id: 'subscription-1' });
      prisma.skillVersion.findUnique.mockResolvedValue({ ...platformVersion, ...version });
      await expect(service.setEnterpriseDefault('admin-1', 'capability-1', platformVersion.id))
        .rejects.toThrow(BadRequestException);
      expect(defaults.lock).not.toHaveBeenCalled();
      expect(defaults.set).not.toHaveBeenCalled();
    });
  });

  it('creates an enterprise draft with numbering under the lock without publishing it', async () => {
    prisma.subscription.findFirst.mockResolvedValue({ id: 'subscription-1', employeeId: 'employee-1' });
    prisma.employeeCapabilityBinding.findFirst.mockResolvedValue({ id: 'binding-1' });
    prisma.skillVersion.findUnique.mockResolvedValue(platformVersion);
    prisma.skillVersion.findMany.mockResolvedValue([{ version: '1.1.0' }]);
    const draft = { id: 'enterprise-draft', version: '1.1.1', status: 'DRAFT' };
    prisma.skillVersion.create.mockResolvedValue(draft);

    await expect(service.createEnterpriseVersion('user-1', 'subscription-1', {
      capabilityId: 'capability-1', parentVersionId: platformVersion.id, changeSummary: 'Draft improvement',
    })).resolves.toEqual(draft);

    expect(prisma.subscription.findFirst).toHaveBeenCalledWith(expect.objectContaining({ where: expect.objectContaining({
      enterpriseId: 'enterprise-1', id: 'subscription-1', status: 'ACTIVE',
      grants: { some: { OR: [{ memberId: 'member-1' }, { departmentId: 'department-1' }],
        AND: [{ OR: [{ expiresAt: null }, { expiresAt: { gt: expect.any(Date) } }] }] } },
    }) }));
    expect(defaults.lock).toHaveBeenCalledWith(prisma, 'enterprise-1', 'capability-1');
    expect(defaults.lock.mock.invocationCallOrder[0]).toBeLessThan(prisma.skillVersion.findMany.mock.invocationCallOrder[0]);
    expect(prisma.skillVersion.create).toHaveBeenCalledWith(expect.objectContaining({ data: {
      capabilityId: 'capability-1', enterpriseId: 'enterprise-1', scope: 'ENTERPRISE',
      parentVersionId: platformVersion.id, version: '1.1.1', content: platformVersion.content,
      changeSummary: 'Draft improvement', createdById: 'user-1',
    } }));
    expect(defaults.set).not.toHaveBeenCalled();
    expect(prisma.skillVersionReview.create).not.toHaveBeenCalled();
    expect(prisma.subscriptionSkillVersion.upsert).not.toHaveBeenCalled();
  });

  it('allows an enterprise-rejected version to be edited again', async () => {
    enterpriseContext.resolve.mockResolvedValue(adminContext);
    prisma.skillVersion.findFirst.mockResolvedValue({
      id: 'rejected-version',
      capabilityId: 'capability-1',
      enterpriseId: 'enterprise-1',
      scope: 'ENTERPRISE',
      parentVersionId: 'parent-version',
      status: 'ENTERPRISE_REJECTED',
    });
    prisma.skillVersion.update.mockResolvedValue({ id: 'rejected-version' });

    await service.updateEnterpriseVersion('user-1', 'rejected-version', {
      content: '# Revised skill',
      changeSummary: '修正审核意见中的步骤说明',
    });

    expect(prisma.skillVersion.update).toHaveBeenCalled();
    expect(defaults.lock).toHaveBeenCalledWith(prisma, 'enterprise-1', 'capability-1');
    expect(prisma.skillVersion.findFirst).toHaveBeenCalledTimes(2);
    expect(defaults.lock.mock.invocationCallOrder[0]).toBeLessThan(prisma.skillVersion.findFirst.mock.invocationCallOrder[1]);
    expect(prisma.skillVersion.findFirst.mock.invocationCallOrder[1]).toBeLessThan(prisma.skillVersion.update.mock.invocationCallOrder[0]);
  });

  it.each(['MEMBER', 'DEPT_MANAGER'] as const)('denies %s editing an enterprise draft', async (role) => {
    enterpriseContext.resolve.mockResolvedValue({ ...memberContext, role });
    await expect(service.updateEnterpriseVersion('user-1', 'enterprise-draft', { content: 'Forbidden body' }))
      .rejects.toBeInstanceOf(ForbiddenException);
    expect(prisma.skillVersion.findFirst).not.toHaveBeenCalled();
    expect(prisma.$transaction).not.toHaveBeenCalled();
    expect(defaults.lock).not.toHaveBeenCalled();
    expect(prisma.skillVersion.update).not.toHaveBeenCalled();
  });

  it('edits a draft only after rereading its tenant-scoped state inside the shared lock', async () => {
    enterpriseContext.resolve.mockResolvedValue(adminContext);
    const draft = { id: 'enterprise-draft', capabilityId: 'capability-1', status: 'DRAFT' };
    prisma.skillVersion.findFirst.mockResolvedValue(draft);
    prisma.skillVersion.update.mockResolvedValue({ ...draft, content: '# Edited' });
    await expect(service.updateEnterpriseVersion('admin-1', draft.id, {
      content: '---\nname: skill\n---\n\n# Edited', changeSummary: 'Revised draft',
    })).resolves.toMatchObject({ content: '# Edited' });
    expect(prisma.$transaction).toHaveBeenCalledTimes(1);
    expect(defaults.lock).toHaveBeenCalledWith(prisma, 'enterprise-1', 'capability-1');
    expect(prisma.skillVersion.findFirst).toHaveBeenNthCalledWith(2, { where: {
      id: draft.id, enterpriseId: 'enterprise-1', scope: 'ENTERPRISE',
    } });
    expect(defaults.lock.mock.invocationCallOrder[0]).toBeLessThan(prisma.skillVersion.findFirst.mock.invocationCallOrder[1]);
    expect(prisma.skillVersion.update).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: draft.id }, data: { content: '# Edited', changeSummary: 'Revised draft' },
    }));
    expect(defaults.set).not.toHaveBeenCalled();
  });

  it.each([
    [null, NotFoundException],
    [{ status: 'ENTERPRISE_APPROVED' }, ConflictException],
    [{ status: 'PENDING_ENTERPRISE_REVIEW' }, ConflictException],
    [{ status: 'ARCHIVED' }, ConflictException],
  ] as const)('rejects editing when the locked draft has disappeared or changed state: %j', async (current, Exception) => {
    enterpriseContext.resolve.mockResolvedValue(adminContext);
    const draft = { id: 'enterprise-draft', capabilityId: 'capability-1', status: 'DRAFT' };
    prisma.skillVersion.findFirst.mockResolvedValueOnce(draft).mockResolvedValueOnce(current);
    await expect(service.updateEnterpriseVersion('admin-1', draft.id, { content: 'Must never overwrite publication' }))
      .rejects.toBeInstanceOf(Exception);
    expect(defaults.lock).toHaveBeenCalledWith(prisma, 'enterprise-1', 'capability-1');
    expect(prisma.skillVersion.findFirst).toHaveBeenNthCalledWith(2, { where: {
      id: draft.id, enterpriseId: 'enterprise-1', scope: 'ENTERPRISE',
    } });
    expect(defaults.lock.mock.invocationCallOrder[0]).toBeLessThan(prisma.skillVersion.findFirst.mock.invocationCallOrder[1]);
    expect(prisma.skillVersion.update).not.toHaveBeenCalled();
    expect(defaults.set).not.toHaveBeenCalled();
  });

  it('refuses to publish an already-approved version', async () => {
    enterpriseContext.resolve.mockResolvedValue(adminContext);
    prisma.skillVersion.findFirst.mockResolvedValue({
      id: 'approved-version',
      capabilityId: 'capability-1',
      status: 'ENTERPRISE_APPROVED',
      version: '1.1.0',
    });

    await expect(service.publishEnterpriseVersion('user-1', 'approved-version')).rejects.toThrow(
      ConflictException,
    );
    expect(prisma.skillVersion.update).not.toHaveBeenCalled();
  });

  // 提审流删掉后，存量卡在「待企业审核」的版本必须还有出路 ——
  // 不接受它们等于把那些数据永久锁死在界面上
  it('accepts a legacy PENDING_ENTERPRISE_REVIEW version for publishing', async () => {
    enterpriseContext.resolve.mockResolvedValue(adminContext);
    prisma.skillVersion.findFirst.mockResolvedValue({
      id: 'legacy-version',
      capabilityId: 'capability-1',
      status: 'PENDING_ENTERPRISE_REVIEW',
      version: '1.0.2',
    });

    await expect(
      service.publishEnterpriseVersion('user-1', 'legacy-version'),
    ).resolves.toBeDefined();
  });

  it('publishes a legacy enterprise draft under the shared default lock', async () => {
    enterpriseContext.resolve.mockResolvedValue(adminContext);
    const draft = { id: 'draft-version', capabilityId: 'capability-1', status: 'DRAFT', version: '1.1.0' };
    const approved = { ...draft, status: 'ENTERPRISE_APPROVED' };
    prisma.skillVersion.findFirst.mockResolvedValue(draft);
    prisma.skillVersion.update.mockResolvedValue(approved);
    defaults.set.mockResolvedValue({ affectedSubscriptions: 2 });
    await expect(service.publishEnterpriseVersion('admin-1', draft.id))
      .resolves.toMatchObject({ version: approved, affectedSubscriptions: 2 });
    expect(defaults.lock).toHaveBeenCalledWith(prisma, 'enterprise-1', 'capability-1');
    expect(defaults.set).toHaveBeenCalledWith(prisma, 'enterprise-1', 'capability-1', draft.id, 'admin-1');
    expect(defaults.lock.mock.invocationCallOrder[0]).toBeLessThan(prisma.skillVersion.update.mock.invocationCallOrder[0]);
    expect(prisma.subscriptionSkillVersion.upsert).not.toHaveBeenCalled();
  });

  it('creates an enterprise publication with version numbering inside the default lock', async () => {
    const published = { id: 'enterprise-new', version: '1.1.1', scope: 'ENTERPRISE', status: 'ENTERPRISE_APPROVED' };
    prisma.skillVersion.findMany.mockResolvedValue([{ version: '1.1.0' }]);
    prisma.skillVersion.findFirst.mockResolvedValue(null);
    prisma.skillVersion.create.mockResolvedValue(published);
    await expect(service.createEnterpriseVersionFromContent('admin-1', 'enterprise-1', 'capability-1', '# New', 'Reviewed improvement'))
      .resolves.toEqual(published);
    expect(defaults.lock).toHaveBeenCalledWith(prisma, 'enterprise-1', 'capability-1');
    expect(defaults.lock.mock.invocationCallOrder[0]).toBeLessThan(prisma.skillVersion.findMany.mock.invocationCallOrder[0]);
    expect(prisma.skillVersion.create).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({
      enterpriseId: 'enterprise-1', capabilityId: 'capability-1', version: '1.1.1', content: '# New',
    }) }));
    expect(defaults.set).toHaveBeenCalledWith(prisma, 'enterprise-1', 'capability-1', published.id, 'admin-1');
    expect(prisma.subscriptionSkillVersion.upsert).not.toHaveBeenCalled();
  });

  it('does not change defaults or append a review when another publisher won the atomic claim', async () => {
    enterpriseContext.resolve.mockResolvedValue(adminContext);
    prisma.skillVersion.findFirst.mockResolvedValue({
      id: 'draft-version', capabilityId: 'capability-1', status: 'DRAFT', version: '1.1.0',
    });
    prisma.skillVersion.updateMany.mockResolvedValue({ count: 0 });
    await expect(service.publishEnterpriseVersion('admin-1', 'draft-version')).rejects.toThrow(ConflictException);
    expect(defaults.lock).toHaveBeenCalledWith(prisma, 'enterprise-1', 'capability-1');
    expect(defaults.set).not.toHaveBeenCalled();
    expect(prisma.skillVersion.update).not.toHaveBeenCalled();
    expect(prisma.skillVersionReview.create).not.toHaveBeenCalled();
  });

  it('creates a platform review copy without changing the enterprise source version', async () => {
    enterpriseContext.resolve.mockResolvedValue(adminContext);
    const enterpriseVersion = {
      ...platformVersion,
      id: 'enterprise-version',
      scope: 'ENTERPRISE',
      enterpriseId: 'enterprise-1',
      status: 'ENTERPRISE_APPROVED',
    };
    prisma.skillVersion.findFirst.mockResolvedValue(enterpriseVersion);
    prisma.skillVersion.findUnique.mockResolvedValue(null);
    prisma.skillVersion.findMany.mockResolvedValue([]);
    prisma.skillVersion.create.mockResolvedValue({ id: 'platform-copy' });

    await service.submitPlatformReview('admin-1', enterpriseVersion.id);

    expect(prisma.skillVersion.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          scope: 'PLATFORM',
          sourceVersionId: enterpriseVersion.id,
          status: 'PENDING_PLATFORM_REVIEW',
          content: enterpriseVersion.content,
        }),
      }),
    );
    expect(prisma.skillVersion.update).not.toHaveBeenCalled();
  });

  it('rejects only the platform copy and leaves the enterprise source untouched', async () => {
    prisma.skillVersion.findFirst.mockResolvedValue({
      ...platformVersion,
      id: 'platform-copy',
      sourceVersionId: 'enterprise-version',
      status: 'PENDING_PLATFORM_REVIEW',
    });
    prisma.skillVersion.update.mockResolvedValue({ id: 'platform-copy' });

    await service.reviewPlatformVersion('platform-admin', 'platform-copy', {
      decision: 'REJECT',
      comment: 'Needs changes',
    });

    expect(prisma.skillVersion.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'platform-copy' },
        data: expect.objectContaining({ status: 'PLATFORM_REJECTED' }),
      }),
    );
    expect(prisma.skillVersion.update).not.toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: 'enterprise-version' } }),
    );
  });
  // ──────────── 运营主动采纳企业版本 ────────────
  //
  // 这条路径的存在理由：会议纪要2 §6 的阶梯顶端写的是「采纳与否由平台自己决定
  // （数据本身都在平台）」。在它补上之前，唯一的上行入口是企业管理员投稿，
  // 运营在企业版本列表里只能看。

  const enterpriseSource = {
    ...platformVersion,
    id: 'enterprise-version',
    scope: 'ENTERPRISE',
    enterpriseId: 'enterprise-1',
    status: 'ENTERPRISE_APPROVED',
    version: '1.0.3',
    changeSummary: '加术语表',
    parentVersionId: 'version-platform',
    packageKey: 'skills/abc.zip',
    packageSha256: 'abc',
    packageFileCount: 3,
    packageFilename: 'ui-designer.zip',
    enterprise: { name: '示例科技有限公司' },
  };

  it('adopts an enterprise version as a pending platform copy and leaves the source alone', async () => {
    prisma.skillVersion.findFirst
      .mockResolvedValueOnce(enterpriseSource)
      .mockResolvedValueOnce({ id: 'platform-head' });
    prisma.skillVersion.findUnique.mockResolvedValue(null);
    prisma.skillVersion.findMany.mockResolvedValue([{ version: '1.0.0' }]);
    prisma.skillVersion.create.mockResolvedValue({ id: 'platform-copy' });

    await service.adoptEnterpriseVersion('platform-admin', enterpriseSource.id, {
      mode: 'DRAFT',
    });

    expect(prisma.skillVersion.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          scope: 'PLATFORM',
          sourceVersionId: enterpriseSource.id,
          // 平台谱系的父版本是平台自己的头部，不是企业版的父版本
          parentVersionId: 'platform-head',
          status: 'PENDING_PLATFORM_REVIEW',
          content: enterpriseSource.content,
          // 包字段要跟着正文走，否则平台版拿不到可下载的原始 zip
          packageKey: 'skills/abc.zip',
          packageSha256: 'abc',
          changeSummary: '平台采纳 示例科技有限公司 的 v1.0.3 —— 加术语表',
        }),
      }),
    );
    expect(prisma.skillVersion.update).not.toHaveBeenCalled();
    // 待审状态还没进市场，不该动员工模板的默认版
    expect(prisma.employeeCapabilityBinding.updateMany).not.toHaveBeenCalled();
    expect(prisma.skillVersionReview.create).not.toHaveBeenCalled();
  });

  it('publishes an adopted version and advances the pinned platform defaults', async () => {
    prisma.skillVersion.findFirst
      .mockResolvedValueOnce(enterpriseSource)
      .mockResolvedValueOnce(null);
    prisma.skillVersion.findUnique.mockResolvedValue(null);
    prisma.skillVersion.findMany.mockResolvedValue([]);
    prisma.skillVersion.create.mockResolvedValue({ id: 'platform-copy' });

    await service.adoptEnterpriseVersion('platform-admin', enterpriseSource.id, {
      mode: 'PUBLISH',
      changeSummary: '这一版的检查清单值得所有企业用',
    });

    expect(prisma.skillVersion.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          status: 'PLATFORM_APPROVED',
          platformReviewedById: 'platform-admin',
          changeSummary: '这一版的检查清单值得所有企业用',
        }),
      }),
    );
    // 少了这一步，「直接发布」是个看不出效果的空动作：绑定还钉在旧平台版上
    expect(prisma.employeeCapabilityBinding.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          capabilityId: enterpriseSource.capabilityId,
          defaultSkillVersion: { scope: 'PLATFORM' },
        }),
        data: { defaultSkillVersionId: 'platform-copy' },
      }),
    );
    // 跳过审核也要留审核记录，否则「谁把这一版放进平台的」查不到
    expect(prisma.skillVersionReview.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ actorType: 'PLATFORM', decision: 'APPROVE' }),
      }),
    );
  });

  it('refuses to adopt the same enterprise version twice', async () => {
    prisma.skillVersion.findFirst.mockResolvedValue(enterpriseSource);
    prisma.skillVersion.findUnique.mockResolvedValue({ version: '1.0.1', status: 'PLATFORM_APPROVED' });

    await expect(
      service.adoptEnterpriseVersion('platform-admin', enterpriseSource.id, { mode: 'DRAFT' }),
    ).rejects.toThrow(ConflictException);
    expect(prisma.skillVersion.create).not.toHaveBeenCalled();
  });

  it('refuses to adopt a version the enterprise already archived', async () => {
    prisma.skillVersion.findFirst.mockResolvedValue({ ...enterpriseSource, status: 'ARCHIVED' });

    await expect(
      service.adoptEnterpriseVersion('platform-admin', enterpriseSource.id, { mode: 'PUBLISH' }),
    ).rejects.toThrow(ConflictException);
  });

  it('adopts an enterprise draft — 运营看的是正文，不是企业内部走到哪一步', async () => {
    prisma.skillVersion.findFirst
      .mockResolvedValueOnce({ ...enterpriseSource, status: 'DRAFT' })
      .mockResolvedValueOnce(null);
    prisma.skillVersion.findUnique.mockResolvedValue(null);
    prisma.skillVersion.findMany.mockResolvedValue([]);
    prisma.skillVersion.create.mockResolvedValue({ id: 'platform-copy' });

    await expect(
      service.adoptEnterpriseVersion('platform-admin', enterpriseSource.id, { mode: 'DRAFT' }),
    ).resolves.toBeDefined();
  });

  it('advances platform defaults when a submitted version passes review', async () => {
    prisma.skillVersion.findFirst.mockResolvedValue({
      ...platformVersion,
      id: 'platform-copy',
      status: 'PENDING_PLATFORM_REVIEW',
    });
    prisma.skillVersion.update.mockResolvedValue({ id: 'platform-copy' });

    await service.reviewPlatformVersion('platform-admin', 'platform-copy', {
      decision: 'APPROVE',
    });

    expect(prisma.employeeCapabilityBinding.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({ data: { defaultSkillVersionId: 'platform-copy' } }),
    );
  });

  it('keeps personal copies out of the platform review list', async () => {
    await expect(
      service.listAdminVersions({ scope: 'PERSONAL', page: 1, limit: 20 }),
    ).rejects.toThrow(BadRequestException);

    prisma.skillVersion.findMany.mockResolvedValue([]);
    await service.listAdminVersions({ page: 1, limit: 20 });

    expect(prisma.skillVersion.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { scope: { in: ['PLATFORM', 'ENTERPRISE'] } },
      }),
    );
  });
});
