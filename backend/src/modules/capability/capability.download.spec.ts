import { ForbiddenException, NotFoundException } from '@nestjs/common';
import { CapabilityService } from './capability.service';
import { PrismaService } from '../../prisma/prisma.service';
import { AdapterFactory } from './adapters/adapter.factory';

function makeService(overrides: Record<string, unknown> = {}) {
  const prisma = {
    capability: { findUnique: jest.fn() },
    skillVersion: { findFirst: jest.fn() },
    enterpriseMember: { findFirst: jest.fn() },
    employeeGrant: { findFirst: jest.fn() },
    ...overrides,
  };
  return {
    prisma,
    service: new CapabilityService(
      prisma as unknown as PrismaService,
      {} as AdapterFactory,
      {} as any,
    ),
  };
}

const publicCapability = {
  id: 'cap-public',
  name: '公开技能',
  type: 'SKILL',
  contributorId: 'other-user',
  enterpriseId: null,
  visibility: 'MARKET_PUBLIC',
  platformReviewStatus: 'APPROVED',
  status: 'APPROVED',
  metadata: null,
};

describe('CapabilityService download access', () => {
  it('allows authenticated users to download a platform-approved public Skill', async () => {
    const { prisma, service } = makeService();
    prisma.capability.findUnique.mockResolvedValue(publicCapability);
    prisma.skillVersion.findFirst.mockResolvedValue({
      packageKey: 'skills/public.zip',
      packageFilename: '公开技能.zip',
      version: '1.0.0',
    });

    await expect(
      service.getSkillPackageForDownload('cap-public', 'member-1', 'MEMBER'),
    ).resolves.toEqual({ key: 'skills/public.zip', filename: '公开技能.zip' });
    expect(prisma.enterpriseMember.findFirst).not.toHaveBeenCalled();
    expect(prisma.skillVersion.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          scope: 'PLATFORM',
          status: 'PLATFORM_APPROVED',
          packageKey: { not: null },
        }),
        orderBy: [
          { platformReviewedAt: { sort: 'desc', nulls: 'last' } },
          { createdAt: 'desc' },
          { id: 'desc' },
        ],
      }),
    );
  });

  it('keeps enterprise-approved package selection ordered by creation time', async () => {
    const { prisma, service } = makeService();
    prisma.capability.findUnique.mockResolvedValue({
      ...publicCapability,
      contributorId: 'member-1',
      enterpriseId: 'enterprise-1',
      visibility: 'ENTERPRISE_PRIVATE',
      platformReviewStatus: 'NOT_SUBMITTED',
      status: 'PENDING',
    });
    prisma.skillVersion.findFirst.mockResolvedValue({
      packageKey: 'skills/private.zip',
      version: '1.0.0',
    });

    await service.getSkillPackageForDownload('cap-public', 'member-1', 'MEMBER');

    expect(prisma.skillVersion.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ scope: 'ENTERPRISE', status: 'ENTERPRISE_APPROVED' }),
        orderBy: { createdAt: 'desc' },
      }),
    );
  });

  it('keeps enterprise-private Skill downloads behind an active employee grant', async () => {
    const { prisma, service } = makeService();
    prisma.capability.findUnique.mockResolvedValue({
      ...publicCapability,
      id: 'cap-private',
      visibility: 'ENTERPRISE_PRIVATE',
      platformReviewStatus: 'NOT_SUBMITTED',
      status: 'PENDING',
      enterpriseId: 'enterprise-1',
    });
    prisma.enterpriseMember.findFirst.mockResolvedValue(null);

    await expect(
      service.getSkillPackageForDownload('cap-private', 'member-1', 'MEMBER'),
    ).rejects.toBeInstanceOf(ForbiddenException);
    expect(prisma.skillVersion.findFirst).not.toHaveBeenCalled();
  });

  it('uses the legacy metadata key only when no approved version package exists', async () => {
    const { prisma, service } = makeService();
    prisma.capability.findUnique.mockResolvedValue({
      ...publicCapability,
      metadata: { zipPath: 'skills/legacy.zip' },
    });
    prisma.skillVersion.findFirst.mockResolvedValue(null);

    await expect(
      service.getSkillPackageForDownload('cap-public', 'member-1', 'MEMBER'),
    ).resolves.toEqual({ key: 'skills/legacy.zip', filename: '公开技能.zip' });
  });

  it('does not expose non-Skill capabilities through the Skill download endpoint', async () => {
    const { prisma, service } = makeService();
    prisma.capability.findUnique.mockResolvedValue({
      ...publicCapability,
      type: 'RPA',
    });

    await expect(
      service.getSkillPackageForDownload('cap-rpa', 'member-1', 'MEMBER'),
    ).rejects.toBeInstanceOf(NotFoundException);
  });
});
