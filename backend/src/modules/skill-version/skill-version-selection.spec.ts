import { BadRequestException, ForbiddenException } from '@nestjs/common';
import { SkillVersionService } from './skill-version.service';
import { SelectPersonalSkillVersionDtoSchema } from 'shared';

const ctx = { enterpriseId: 'ent-1', memberId: 'member-1', departmentId: 'dept-1', role: 'MEMBER' };
const platform = { id: 'platform-1', capabilityId: 'cap-1', scope: 'PLATFORM', status: 'PLATFORM_APPROVED' };
const personal = { id: 'personal-1', capabilityId: 'cap-1', enterpriseId: 'ent-1', ownerId: 'user-1', scope: 'PERSONAL', status: 'PERSONAL_ACTIVE' };
const approvedPersonal = { ...personal, id: 'personal-approved-1', status: 'ENTERPRISE_APPROVED' };
function build() {
  const prisma = {
    subscription: {
      findFirst: jest.fn().mockResolvedValue({ id: 'sub-1', employeeId: 'employee-1', enterpriseId: 'ent-1' }),
      findUnique: jest.fn().mockResolvedValue({ enterpriseId: 'ent-1', employee: { bindings: [] } }),
    },
    employeeCapabilityBinding: { findFirst: jest.fn().mockResolvedValue({ id: 'binding-1' }) },
    skillVersion: { findUnique: jest.fn().mockResolvedValue(platform), findFirst: jest.fn().mockResolvedValue(personal) },
    memberSkillVersionSelection: { upsert: jest.fn().mockResolvedValue({}), findFirst: jest.fn().mockResolvedValue(null) },
    subscriptionSkillVersion: { findUnique: jest.fn().mockResolvedValue({ version: platform }), upsert: jest.fn() },
  };
  const context = { resolve: jest.fn().mockResolvedValue(ctx), assertEnterpriseAdmin: jest.fn(() => { throw new ForbiddenException(); }) };
  return { prisma, context, service: new SkillVersionService(prisma as never, context as never) };
}

describe('成员选版隔离与实际执行', () => {
  it('普通成员只写自己的三维选版记录，不写企业默认', async () => {
    const { service, prisma } = build();
    await service.selectPersonalVersion('user-1', 'sub-1', 'cap-1', platform.id);
    expect(prisma.memberSkillVersionSelection.upsert).toHaveBeenCalledWith(expect.objectContaining({
      where: { memberId_subscriptionId_capabilityId: { memberId: 'member-1', subscriptionId: 'sub-1', capabilityId: 'cap-1' } },
      create: expect.objectContaining({ memberId: 'member-1', versionId: platform.id }),
    }));
    expect(prisma.subscriptionSkillVersion.upsert).not.toHaveBeenCalled();
    expect(prisma.subscription.findFirst).toHaveBeenCalledWith(expect.objectContaining({ where: expect.objectContaining({
      id: 'sub-1', enterpriseId: 'ent-1', status: 'ACTIVE', grants: expect.anything(), OR: expect.anything(),
    }) }));
  });
  it('无授权的订阅拒绝，不能越企业/越成员授权', async () => {
    const { service, prisma } = build();
    prisma.subscription.findFirst.mockResolvedValue(null);
    await expect(service.selectPersonalVersion('user-1', 'alien-sub', 'cap-1', platform.id)).rejects.toBeInstanceOf(ForbiddenException);
    expect(prisma.memberSkillVersionSelection.upsert).not.toHaveBeenCalled();
  });
  it.each([
    { ...platform, capabilityId: 'other-cap' },
    { ...platform, status: 'PLATFORM_PENDING_REVIEW' },
    { ...platform, scope: 'ENTERPRISE', status: 'ENTERPRISE_APPROVED', enterpriseId: 'other-ent' },
    { ...personal, ownerId: 'other-user' },
    { ...personal, status: 'ARCHIVED' },
    { ...personal, enterpriseId: 'other-ent' },
    { ...approvedPersonal, status: 'PENDING_ENTERPRISE_REVIEW' },
    { ...approvedPersonal, status: 'ENTERPRISE_REJECTED' },
    { ...approvedPersonal, ownerId: 'other-user' },
    { ...approvedPersonal, enterpriseId: 'other-ent' },
    { ...approvedPersonal, capabilityId: 'other-cap' },
  ])('拒绝不可用版本 %j', async (version) => {
    const { service, prisma } = build();
    prisma.skillVersion.findUnique.mockResolvedValue(version as typeof platform);
    await expect(service.selectPersonalVersion('user-1', 'sub-1', 'cap-1', version.id)).rejects.toBeInstanceOf(BadRequestException);
    expect(prisma.memberSkillVersionSelection.upsert).not.toHaveBeenCalled();
  });
  it.each([personal, approvedPersonal, { ...platform, scope: 'ENTERPRISE', enterpriseId: 'ent-1', status: 'ENTERPRISE_APPROVED' }])('可用本企业版本/本人副本/本人审核通过版本可选', async (version) => {
    const { service, prisma } = build();
    prisma.skillVersion.findUnique.mockResolvedValue(version as typeof platform);
    await service.selectPersonalVersion('user-1', 'sub-1', 'cap-1', version.id);
    expect(prisma.memberSkillVersionSelection.upsert).toHaveBeenCalledWith(expect.objectContaining({
      create: expect.objectContaining({ memberId: 'member-1', versionId: version.id }),
      update: { versionId: version.id },
    }));
    expect(prisma.subscriptionSkillVersion.upsert).not.toHaveBeenCalled();
  });
  it('本人送审通过后显式选版，执行解析使用同一版本而非旧副本或企业默认', async () => {
    const { service, prisma } = build();
    prisma.skillVersion.findUnique.mockResolvedValue(approvedPersonal as typeof platform);
    prisma.memberSkillVersionSelection.upsert.mockImplementation(async ({ create }) => {
      prisma.memberSkillVersionSelection.findFirst.mockResolvedValue({
        versionId: create.versionId, version: approvedPersonal,
      });
      return create;
    });
    await service.selectPersonalVersion('user-1', 'sub-1', 'cap-1', approvedPersonal.id);
    await expect(service.resolveEffectiveVersion('sub-1', 'cap-1', 'user-1')).resolves.toEqual(approvedPersonal);
    expect(prisma.skillVersion.findFirst).not.toHaveBeenCalled();
    expect(prisma.subscriptionSkillVersion.findUnique).not.toHaveBeenCalled();
    expect(prisma.subscriptionSkillVersion.upsert).not.toHaveBeenCalled();
    expect(prisma.memberSkillVersionSelection.findFirst).toHaveBeenCalledWith(expect.objectContaining({ where: {
      subscriptionId: 'sub-1', capabilityId: 'cap-1', member: { userId: 'user-1', enterpriseId: 'ent-1' },
    } }));
  });
  it.each([
    { ...approvedPersonal, status: 'PENDING_ENTERPRISE_REVIEW' },
    { ...approvedPersonal, status: 'ENTERPRISE_REJECTED' },
    { ...approvedPersonal, ownerId: 'other-user' },
    { ...approvedPersonal, enterpriseId: 'other-ent' },
    { ...approvedPersonal, capabilityId: 'other-cap' },
  ])('执行解析不使用无效或越权的个人显式选版 %j', async (version) => {
    const { service, prisma } = build();
    prisma.memberSkillVersionSelection.findFirst.mockResolvedValue({ versionId: version.id, version });
    await expect(service.resolveEffectiveVersion('sub-1', 'cap-1', 'user-1')).resolves.toEqual(platform);
    expect(prisma.skillVersion.findFirst).not.toHaveBeenCalled();
  });
  it('显式选版胜过已存在的个人副本和企业默认', async () => {
    const { service, prisma } = build();
    prisma.memberSkillVersionSelection.findFirst.mockResolvedValue({ versionId: platform.id, version: platform } as never);
    await expect(service.resolveEffectiveVersion('sub-1', 'cap-1', 'user-1')).resolves.toEqual(platform);
    expect(prisma.skillVersion.findFirst).not.toHaveBeenCalled();
    expect(prisma.memberSkillVersionSelection.findFirst).toHaveBeenCalledWith(expect.objectContaining({ where: {
      subscriptionId: 'sub-1', capabilityId: 'cap-1', member: { userId: 'user-1', enterpriseId: 'ent-1' },
    } }));
  });
  it('null 明确跟随企业，即使有副本也不使用、不删除副本', async () => {
    const { service, prisma } = build();
    await service.selectPersonalVersion('user-1', 'sub-1', 'cap-1', null);
    expect(prisma.memberSkillVersionSelection.upsert).toHaveBeenCalledWith(expect.objectContaining({ update: { versionId: null } }));
    prisma.memberSkillVersionSelection.findFirst.mockResolvedValue({ versionId: null, version: null } as never);
    await expect(service.resolveEffectiveVersion('sub-1', 'cap-1', 'user-1')).resolves.toEqual(platform);
    expect(prisma.skillVersion.findFirst).not.toHaveBeenCalled();
  });
  it('无显式偏好兼容旧个人副本，但只查询当前订阅企业', async () => {
    const { service, prisma } = build();
    await expect(service.resolveEffectiveVersion('sub-1', 'cap-1', 'user-1')).resolves.toEqual(personal);
    expect(prisma.skillVersion.findFirst).toHaveBeenCalledWith(expect.objectContaining({ where: expect.objectContaining({ enterpriseId: 'ent-1', ownerId: 'user-1' }) }));
  });
  it('无使用者执行只使用企业默认', async () => {
    const { service, prisma } = build();
    await expect(service.resolveEffectiveVersion('sub-1', 'cap-1')).resolves.toEqual(platform);
    expect(prisma.memberSkillVersionSelection.findFirst).not.toHaveBeenCalled();
  });
  it('普通成员仍不能改企业默认', async () => {
    const { service, prisma } = build();
    await expect(service.selectVersion('user-1', 'sub-1', 'cap-1', platform.id)).rejects.toBeInstanceOf(ForbiddenException);
    expect(prisma.subscriptionSkillVersion.upsert).not.toHaveBeenCalled();
  });
  it('共享 DTO 拒绝缺失/空值，只允许非空ID或明确null', () => {
    expect(SelectPersonalSkillVersionDtoSchema.safeParse({}).success).toBe(false);
    expect(SelectPersonalSkillVersionDtoSchema.safeParse({ versionId: '' }).success).toBe(false);
    expect(SelectPersonalSkillVersionDtoSchema.parse({ versionId: null })).toEqual({ versionId: null });
  });
});
