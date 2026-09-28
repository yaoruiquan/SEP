import { BadRequestException } from '@nestjs/common';
import { PackageSecurityScanStatus, PackageSecurityType } from '@prisma/client';
import { PackageSecurityService } from './package-security.service';

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
