import { BadRequestException, Injectable } from '@nestjs/common';
import { PackageSecurityScanStatus, PackageSecurityType, Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { CapabilityValidatorService } from './capability-validator.service';

/**
 * 上传包安全门禁。
 *
 * 当前内置 provider 只做 ZIP 结构、凭据特征和 Skill 正文静态检查；绝不在服务端
 * 执行包内脚本。当前不接入病毒库或隔离沙箱；扫描状态只代表本地静态规则
 * 检查结果，必须保留 STATIC_ONLY_SCAN 警告，不能包装成恶意软件检测结论。
 */
@Injectable()
export class PackageSecurityService {
  private readonly scannerVersion = 'static-zip-v1';

  constructor(
    private readonly prisma: PrismaService,
    private readonly validator: CapabilityValidatorService,
  ) {}

  async scanSkill(input: { sha256: string; content: string; fileCount: number; files?: string[] }) {
    const validation = this.validator.validateSkill(input.content);
    const warnings = [...validation.warnings];
    warnings.push({ code: 'STATIC_ONLY_SCAN', message: '仅完成 Skill 静态规则检查，未运行病毒库或沙箱扫描，需由审核人完成人工安全复核' });
    return this.save({
      packageSha256: input.sha256,
      packageType: PackageSecurityType.SKILL,
      status: validation.valid ? PackageSecurityScanStatus.PASSED : PackageSecurityScanStatus.FAILED,
      issues: validation.issues,
      warnings,
    });
  }

  async scanRpa(input: { sha256: string; files: string[]; fileCount: number }) {
    const warnings = [
      { code: 'STATIC_ONLY_SCAN', message: '仅完成 ZIP 结构与敏感信息静态检查，未运行病毒库或沙箱扫描；RPA 包不得在服务端执行，需人工复核' },
      ...(input.files.some((file) => /\.(?:exe|dll|bat|cmd|ps1|sh|py|js)$/i.test(file))
        ? [{ code: 'EXECUTABLE_CONTENT', message: '包内包含可执行或脚本文件，审核时需确认来源与运行权限' }]
        : []),
    ];
    return this.save({
      packageSha256: input.sha256,
      packageType: PackageSecurityType.RPA,
      status: PackageSecurityScanStatus.PASSED,
      issues: [],
      warnings,
    });
  }

  async getScan(packageSha256: string, packageType: PackageSecurityType) {
    return this.prisma.packageSecurityScan.findUnique({
      where: { packageSha256_packageType: { packageSha256, packageType } },
      select: { status: true, scanner: true, scannerVersion: true, issues: true, warnings: true, scannedAt: true },
    });
  }

  async assertDownloadable(packageSha256: string, packageType: PackageSecurityType) {
    const scan = await this.prisma.packageSecurityScan.findUnique({
      where: { packageSha256_packageType: { packageSha256, packageType } },
      select: { status: true },
    });
    // 存量包没有扫描记录时不阻断历史已发布数据；新上传包一定会写记录。
    if (scan && scan.status !== PackageSecurityScanStatus.PASSED) {
      throw new BadRequestException('该能力包未通过安全扫描，暂不可下载');
    }
  }

  async assertReviewable(packageSha256: string, packageType: PackageSecurityType) {
    const scan = await this.prisma.packageSecurityScan.findUnique({
      where: { packageSha256_packageType: { packageSha256, packageType } },
      select: { status: true, issues: true },
    });
    // 历史存量包没有扫描记录时保留兼容；新上传包必须先有明确扫描结论。
    if (scan && scan.status !== PackageSecurityScanStatus.PASSED) {
      throw new BadRequestException({
        message: '该能力包未通过安全扫描，暂不能提交审核',
        security: scan,
      });
    }
  }

  async metrics() {
    const [byStatus, recentFailures] = await Promise.all([
      this.prisma.packageSecurityScan.groupBy({ by: ['packageType', 'status'], _count: { _all: true } }),
      this.prisma.packageSecurityScan.findMany({
        where: { status: { in: ['FAILED', 'QUARANTINED'] } },
        orderBy: { createdAt: 'desc' },
        take: 20,
        select: { id: true, packageSha256: true, packageType: true, status: true, issues: true, scannedAt: true },
      }),
    ]);
    return { byStatus, recentFailures };
  }

  private save(input: {
    packageSha256: string;
    packageType: PackageSecurityType;
    status: PackageSecurityScanStatus;
    issues: unknown[];
    warnings: unknown[];
  }) {
    return this.prisma.packageSecurityScan.upsert({
      where: { packageSha256_packageType: { packageSha256: input.packageSha256, packageType: input.packageType } },
      create: {
        packageSha256: input.packageSha256,
        packageType: input.packageType,
        status: input.status,
        scanner: 'static',
        scannerVersion: this.scannerVersion,
        issues: input.issues as Prisma.InputJsonValue,
        warnings: input.warnings as Prisma.InputJsonValue,
        scannedAt: new Date(),
      },
      update: {
        status: input.status,
        scanner: 'static',
        scannerVersion: this.scannerVersion,
        issues: input.issues as Prisma.InputJsonValue,
        warnings: input.warnings as Prisma.InputJsonValue,
        scannedAt: new Date(),
      },
    });
  }
}
