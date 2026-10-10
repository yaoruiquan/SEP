import { BadRequestException } from '@nestjs/common';
import { PackageSecurityScanStatus, PackageSecurityType } from '@prisma/client';
import { PackageSecurityService } from './package-security.service';
import { CapabilityValidatorService } from './capability-validator.service';

describe('PackageSecurityService', () => {
  const prisma = {
    packageSecurityScan: {
      upsert: jest.fn(),
      findUnique: jest.fn(),
      groupBy: jest.fn(),
      findMany: jest.fn(),
    },
  };
  const validator = { validateSkill: jest.fn() };
  const service = new PackageSecurityService(prisma as never, validator as never);

  beforeEach(() => {
    jest.resetAllMocks();
    prisma.packageSecurityScan.upsert.mockImplementation(async ({ create }: any) => create);
  });

  it('records Skill static validation failures and keeps the static-only warning', async () => {
    validator.validateSkill.mockReturnValue({ valid: false, issues: [{ code: 'MISSING_SECTION' }], warnings: [] });

    await service.scanSkill({ sha256: 'a'.repeat(64), content: 'bad', fileCount: 1 });

    expect(prisma.packageSecurityScan.upsert).toHaveBeenCalledWith(expect.objectContaining({
      create: expect.objectContaining({
        packageType: PackageSecurityType.SKILL,
        status: PackageSecurityScanStatus.FAILED,
        scannerVersion: 'static-zip-v1',
        issues: [{ code: 'MISSING_SECTION' }],
        warnings: [expect.objectContaining({ code: 'STATIC_ONLY_SCAN' })],
      }),
    }));
  });

  it('blocks review when a package has not passed static checks', async () => {
    prisma.packageSecurityScan.findUnique.mockResolvedValue({
      status: PackageSecurityScanStatus.QUARANTINED,
      issues: [{ code: 'SUSPICIOUS_CONTENT' }],
    });

    await expect(service.assertReviewable('b'.repeat(64), PackageSecurityType.RPA))
      .rejects.toBeInstanceOf(BadRequestException);
  });

  it('marks a safe Skill package as passed with non-blocking heading warnings', async () => {
    const service = new PackageSecurityService(prisma as never, new CapabilityValidatorService());
    await service.scanSkill({ sha256: 'e'.repeat(64), content: '# 多平台经营协同\n基于用户授权数据分析多平台经营，输出风险及待确认动作。\n姚瑞泉测试', fileCount: 1 });
    expect(prisma.packageSecurityScan.upsert).toHaveBeenCalledWith(expect.objectContaining({
      create: expect.objectContaining({ status: PackageSecurityScanStatus.PASSED, issues: [],
        warnings: expect.arrayContaining([
          expect.objectContaining({ code: 'SECTION_ROLE' }),
          expect.objectContaining({ code: 'STATIC_ONLY_SCAN' }),
        ]),
      }),
    }));
  });

  it('still marks credential-bearing Skill packages as failed', async () => {
    const service = new PackageSecurityService(prisma as never, new CapabilityValidatorService());
    await service.scanSkill({ sha256: 'f'.repeat(64), content: 'api_key = example-secret-value', fileCount: 1 });
    expect(prisma.packageSecurityScan.upsert).toHaveBeenCalledWith(expect.objectContaining({
      create: expect.objectContaining({ status: PackageSecurityScanStatus.FAILED,
        issues: expect.arrayContaining([expect.objectContaining({ code: 'SECRET_API_KEY' })]),
      }),
    }));
  });

  it('blocks review when a package has no scan record', async () => {
    prisma.packageSecurityScan.findUnique.mockResolvedValue(null);

    await expect(service.assertReviewable('c'.repeat(64), PackageSecurityType.SKILL))
      .rejects.toBeInstanceOf(BadRequestException);
  });

  it('blocks download when a package has no scan record', async () => {
    prisma.packageSecurityScan.findUnique.mockResolvedValue(null);

    await expect(service.assertDownloadable('d'.repeat(64), PackageSecurityType.RPA))
      .rejects.toBeInstanceOf(BadRequestException);
  });

  it('blocks download after a scan failure', async () => {
    prisma.packageSecurityScan.findUnique.mockResolvedValue({ status: PackageSecurityScanStatus.FAILED });

    await expect(service.assertDownloadable('d'.repeat(64), PackageSecurityType.SKILL))
      .rejects.toBeInstanceOf(BadRequestException);
  });
});
