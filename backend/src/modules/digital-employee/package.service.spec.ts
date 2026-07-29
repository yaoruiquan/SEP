import { Test } from '@nestjs/testing';
import { BadRequestException, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PackageService } from './package.service';
import { PrismaService } from '../../prisma/prisma.service';

/** 最小合法 ZIP：魔数 PK\x03\x04 + 填充 */
const zipBuffer = (extra = 'x') =>
  Buffer.concat([Buffer.from([0x50, 0x4b, 0x03, 0x04]), Buffer.from(extra)]);

const zipFile = (over: Partial<{ originalname: string; size: number }> = {}) => ({
  originalname: over.originalname ?? 'pkg.zip',
  buffer: zipBuffer(),
  size: over.size ?? 1024,
});

describe('PackageService', () => {
  let service: PackageService;
  let prisma: any;

  beforeEach(async () => {
    prisma = {
      digitalEmployee: { findUnique: jest.fn(), update: jest.fn() },
      employeePackage: {
        findFirst: jest.fn().mockResolvedValue(null),
        findMany: jest.fn().mockResolvedValue([]),
        create: jest.fn(),
      },
      employeeGrant: { findFirst: jest.fn().mockResolvedValue(null) },
      $transaction: jest.fn(),
    };

    const mod = await Test.createTestingModule({
      providers: [
        PackageService,
        { provide: PrismaService, useValue: prisma },
        {
          provide: ConfigService,
          // 指到临时目录，避免测试往仓库里写文件
          useValue: { get: () => '/tmp/sep-test-packages' },
        },
      ],
    }).compile();

    service = mod.get(PackageService);
  });

  // ── 上传校验 ──────────────────────────────────────────────────────────────

  describe('publish 的输入校验', () => {
    it('非 ZIP 魔数一律拒绝 —— 扩展名与 mimetype 都可伪造', async () => {
      await expect(
        service.publish('emp-1', 'u1', { version: '1.0.0' }, {
          originalname: 'evil.zip',
          buffer: Buffer.from('#!/bin/sh\nrm -rf /'),
          size: 20,
        }),
      ).rejects.toThrow(BadRequestException);
      // 未落库
      expect(prisma.employeePackage.create).not.toHaveBeenCalled();
    });

    it('空文件拒绝', async () => {
      await expect(
        service.publish('emp-1', 'u1', { version: '1.0.0' }, {
          originalname: 'empty.zip',
          buffer: Buffer.alloc(0),
          size: 0,
        }),
      ).rejects.toThrow(BadRequestException);
    });

    it('超过 20MB 上限拒绝', async () => {
      await expect(
        service.publish('emp-1', 'u1', { version: '1.0.0' },
          zipFile({ size: 21 * 1024 * 1024 })),
      ).rejects.toThrow(BadRequestException);
    });

    it('模板不存在返回 404', async () => {
      prisma.digitalEmployee.findUnique.mockResolvedValue(null);
      await expect(
        service.publish('nope', 'u1', { version: '1.0.0' }, zipFile()),
      ).rejects.toThrow(NotFoundException);
    });

    it('同一模板同版本重复发布被拒 —— 否则下载方无法确定拿到哪一份', async () => {
      prisma.digitalEmployee.findUnique.mockResolvedValue({ id: 'emp-1', name: '客服' });
      prisma.employeePackage.findFirst.mockResolvedValue({ id: 'existing' });

      await expect(
        service.publish('emp-1', 'u1', { version: '1.0.0' }, zipFile()),
      ).rejects.toThrow(BadRequestException);
    });
  });

  // ── 下载权限（安全边界）───────────────────────────────────────────────────

  describe('resolveDownload 的权限判定', () => {
    const pkgRow = {
      id: 'pkg-1',
      version: '1.0.0',
      filename: 'pkg.zip',
      storagePath: 'emp-1/1.0.0-uuid.zip',
      sha256: 'abc123',
      fileSizeBytes: 1024,
      changelog: null,
      createdAt: new Date(),
    };

    it('没有任何包时 404', async () => {
      prisma.employeePackage.findFirst.mockResolvedValue(null);
      await expect(
        service.resolveDownload({ employeeId: 'emp-1', isPlatformAdmin: true }),
      ).rejects.toThrow(NotFoundException);
    });

    it('平台运营无需授权即可下载（用于上传后验包）', async () => {
      prisma.employeePackage.findFirst.mockResolvedValue(pkgRow);

      const r = await service.resolveDownload({
        employeeId: 'emp-1',
        isPlatformAdmin: true,
      });

      expect(r.sha256).toBe('abc123');
      // 运营路径不查授权
      expect(prisma.employeeGrant.findFirst).not.toHaveBeenCalled();
    });

    it('企业成员无授权时 404 而非 403 —— 不泄漏包是否存在', async () => {
      prisma.employeePackage.findFirst.mockResolvedValue(pkgRow);
      prisma.employeeGrant.findFirst.mockResolvedValue(null);

      await expect(
        service.resolveDownload({
          employeeId: 'emp-1',
          isPlatformAdmin: false,
          enterpriseId: 'ent-a',
          memberId: 'm-1',
          departmentId: 'd-1',
        }),
      ).rejects.toThrow(NotFoundException);
    });

    it('有直接授权可下载', async () => {
      prisma.employeePackage.findFirst.mockResolvedValue(pkgRow);
      prisma.employeeGrant.findFirst.mockResolvedValue({ id: 'g-1' });

      const r = await service.resolveDownload({
        employeeId: 'emp-1',
        isPlatformAdmin: false,
        enterpriseId: 'ent-a',
        memberId: 'm-1',
        departmentId: null,
      });

      expect(r.version).toBe('1.0.0');
    });

    it('授权查询限定本企业 + 该模板 + 实例 ACTIVE + 未过期', async () => {
      prisma.employeePackage.findFirst.mockResolvedValue(pkgRow);
      prisma.employeeGrant.findFirst.mockResolvedValue({ id: 'g-1' });

      await service.resolveDownload({
        employeeId: 'emp-1',
        isPlatformAdmin: false,
        enterpriseId: 'ent-a',
        memberId: 'm-1',
        departmentId: 'd-1',
      });

      const where = prisma.employeeGrant.findFirst.mock.calls[0][0].where;
      expect(where.instance).toMatchObject({
        enterpriseId: 'ent-a',
        templateId: 'emp-1',
        status: 'ACTIVE',
      });
      // 两条授权路径都算
      expect(where.OR).toEqual([{ memberId: 'm-1' }, { departmentId: 'd-1' }]);
      // 过期授权不算
      expect(where.AND[0].OR).toEqual([
        { expiresAt: null },
        { expiresAt: { gt: expect.any(Date) } },
      ]);
    });

    it('无部门的成员只按直接授权查，不带 departmentId 条件', async () => {
      prisma.employeePackage.findFirst.mockResolvedValue(pkgRow);
      prisma.employeeGrant.findFirst.mockResolvedValue({ id: 'g-1' });

      await service.resolveDownload({
        employeeId: 'emp-1',
        isPlatformAdmin: false,
        enterpriseId: 'ent-a',
        memberId: 'm-1',
        departmentId: null,
      });

      const where = prisma.employeeGrant.findFirst.mock.calls[0][0].where;
      expect(where.OR).toEqual([{ memberId: 'm-1' }]);
    });

    it('缺企业上下文（不属于任何企业）直接判无权', async () => {
      prisma.employeePackage.findFirst.mockResolvedValue(pkgRow);

      await expect(
        service.resolveDownload({ employeeId: 'emp-1', isPlatformAdmin: false }),
      ).rejects.toThrow(NotFoundException);
      // 连授权都不查，短路掉
      expect(prisma.employeeGrant.findFirst).not.toHaveBeenCalled();
    });
  });

  // ── 辅助 ──────────────────────────────────────────────────────────────────

  describe('employeeIdsWithPackage', () => {
    it('空数组不查库', async () => {
      const r = await service.employeeIdsWithPackage([]);
      expect(r.size).toBe(0);
      expect(prisma.employeePackage.findMany).not.toHaveBeenCalled();
    });

    it('返回有包的模板 id 集合', async () => {
      prisma.employeePackage.findMany.mockResolvedValue([
        { employeeId: 'emp-1' },
        { employeeId: 'emp-3' },
      ]);

      const r = await service.employeeIdsWithPackage(['emp-1', 'emp-2', 'emp-3']);

      expect(r.has('emp-1')).toBe(true);
      expect(r.has('emp-2')).toBe(false);
      expect(r.has('emp-3')).toBe(true);
    });
  });
});
