import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createHash, randomUUID } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { mkdir, unlink, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { PrismaService } from '../../prisma/prisma.service';
import { PackagePublishDto, PackageView, PACKAGE_MAX_BYTES } from 'shared';

/** 上传文件的最小形状，避免依赖 Express.Multer 的全局类型 */
export interface UploadedZip {
  originalname: string;
  buffer: Buffer;
  size: number;
  mimetype?: string;
}

@Injectable()
export class PackageService {
  private readonly logger = new Logger(PackageService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
  ) {}

  /** 包的存储根目录。默认落在 backend/storage/packages。 */
  private storageRoot(): string {
    return resolve(
      this.config.get<string>('PACKAGE_STORAGE_PATH') ?? 'storage/packages',
    );
  }

  /**
   * 发布新版本：存盘 + 落库 + 同步 DigitalEmployee.version。
   *
   * 三件事必须一起做，否则会出现「版本号变了但没有对应的包」或反之：
   * 前者让用户看到升级提示却下载到旧包，后者让包永远不被提示。
   * 故 version 更新与 package 落库放在同一事务里；文件先落盘，
   * 事务失败时再删掉 —— 宁可留一个孤儿文件，也不要留一条指向不存在文件的记录。
   */
  async publish(
    employeeId: string,
    uploaderId: string,
    dto: PackagePublishDto,
    file: UploadedZip,
  ): Promise<PackageView> {
    this.assertZip(file);

    const employee = await this.prisma.digitalEmployee.findUnique({
      where: { id: employeeId },
      select: { id: true, name: true },
    });
    if (!employee) throw new NotFoundException(`员工模板 ${employeeId} 不存在`);

    // 同一员工同一版本不允许重复发布 —— 否则下载方无法确定拿到的是哪一份
    const dup = await this.prisma.employeePackage.findFirst({
      where: { employeeId, version: dto.version },
      select: { id: true },
    });
    if (dup) {
      throw new BadRequestException(
        `版本 ${dto.version} 已发布过，请改用新版本号`,
      );
    }

    const sha256 = createHash('sha256').update(file.buffer).digest('hex');

    // 存储路径带 uuid，避免同名文件互相覆盖
    const relPath = join(employeeId, `${dto.version}-${randomUUID()}.zip`);
    const absPath = join(this.storageRoot(), relPath);

    await mkdir(join(this.storageRoot(), employeeId), { recursive: true });
    await writeFile(absPath, file.buffer);

    try {
      const pkg = await this.prisma.$transaction(async (tx) => {
        const created = await tx.employeePackage.create({
          data: {
            employeeId,
            version: dto.version,
            filename: this.safeFilename(file.originalname),
            storagePath: relPath,
            sha256,
            fileSizeBytes: file.size,
            uploadedBy: uploaderId,
            changelog: dto.changelog ?? null,
          },
        });

        // 同步模板版本 —— 这一步才让已有实例的 upgradeAvailable 变 true
        await tx.digitalEmployee.update({
          where: { id: employeeId },
          data: { version: dto.version },
        });

        return created;
      });

      this.logger.log(
        `已发布 ${employee.name} v${dto.version}（${file.size} 字节, sha256=${sha256.slice(0, 12)}…）`,
      );
      return this.toView(pkg);
    } catch (err) {
      // 事务失败则清理已落盘的文件，避免留下无主文件
      await unlink(absPath).catch(() => undefined);
      throw err;
    }
  }

  /** 某模板的历史版本列表，新的在前。 */
  async listForEmployee(employeeId: string): Promise<PackageView[]> {
    const rows = await this.prisma.employeePackage.findMany({
      where: { employeeId },
      orderBy: { createdAt: 'desc' },
    });
    return rows.map((r) => this.toView(r));
  }

  /**
   * 取下载所需的文件信息。**权限判定在这里，不要放到 controller。**
   *
   * 允许下载的条件（满足其一）：
   *   ① 平台运营（isPlatformAdmin）—— 用于上传后自检验包；
   *   ② 调用者在本企业对该模板的某个 ACTIVE 实例有未过期授权，
   *      授权的两条路径（直接给个人 / 给所在部门）都算。
   *
   * 无权时一律抛 404 而非 403 —— 与其余接口一致，不泄漏「这个包存在」。
   */
  async resolveDownload(params: {
    employeeId: string;
    isPlatformAdmin: boolean;
    enterpriseId?: string;
    memberId?: string;
    departmentId?: string | null;
  }) {
    const { employeeId, isPlatformAdmin } = params;

    // 取最新版本的包
    const pkg = await this.prisma.employeePackage.findFirst({
      where: { employeeId },
      orderBy: { createdAt: 'desc' },
    });
    if (!pkg) throw new NotFoundException('该员工尚无可下载的员工包');

    if (!isPlatformAdmin) {
      const ok = await this.hasActiveGrant(employeeId, params);
      if (!ok) {
        throw new NotFoundException('该员工尚无可下载的员工包');
      }
    }

    return {
      absPath: join(this.storageRoot(), pkg.storagePath),
      filename: pkg.filename,
      sha256: pkg.sha256,
      fileSizeBytes: pkg.fileSizeBytes,
      version: pkg.version,
      stream: () => createReadStream(join(this.storageRoot(), pkg.storagePath)),
    };
  }

  /** 供 MyEmployees 列表标注哪些模板有包可下。 */
  async employeeIdsWithPackage(employeeIds: string[]): Promise<Set<string>> {
    if (employeeIds.length === 0) return new Set();
    const rows = await this.prisma.employeePackage.findMany({
      where: { employeeId: { in: employeeIds } },
      select: { employeeId: true },
      distinct: ['employeeId'],
    });
    return new Set(rows.map((r) => r.employeeId));
  }

  // ── 内部 ────────────────────────────────────────────────────────────────

  /**
   * 调用者对该模板是否有生效授权。
   * 与 GrantService.myEmployees 的判定保持一致：实例必须 ACTIVE，
   * 授权未过期，直接授权与部门授权都算。
   */
  private async hasActiveGrant(
    employeeId: string,
    p: { enterpriseId?: string; memberId?: string; departmentId?: string | null },
  ): Promise<boolean> {
    if (!p.enterpriseId || !p.memberId) return false;

    const now = new Date();
    const targets: Array<Record<string, unknown>> = [{ memberId: p.memberId }];
    if (p.departmentId) targets.push({ departmentId: p.departmentId });

    const grant = await this.prisma.employeeGrant.findFirst({
      where: {
        OR: targets,
        AND: [{ OR: [{ expiresAt: null }, { expiresAt: { gt: now } }] }],
        instance: {
          enterpriseId: p.enterpriseId,
          templateId: employeeId,
          status: 'ACTIVE',
        },
      },
      select: { id: true },
    });
    return grant !== null;
  }

  private assertZip(file: UploadedZip) {
    if (!file?.buffer?.length) {
      throw new BadRequestException('请选择要上传的 ZIP 文件');
    }
    if (file.size > PACKAGE_MAX_BYTES) {
      throw new BadRequestException(
        `文件超过 ${PACKAGE_MAX_BYTES / 1024 / 1024}MB 上限`,
      );
    }
    // 只认 ZIP 魔数 PK\x03\x04 —— 扩展名与 mimetype 都可伪造，
    // 而下载方会当 ZIP 解压，传错格式要到本地才发现
    const magic = file.buffer.subarray(0, 4);
    const isZip =
      magic[0] === 0x50 &&
      magic[1] === 0x4b &&
      (magic[2] === 0x03 || magic[2] === 0x05 || magic[2] === 0x07);
    if (!isZip) {
      throw new BadRequestException('文件不是有效的 ZIP 格式');
    }
  }

  /**
   * 清理文件名。原始名会进 Content-Disposition，
   * 路径分隔符与控制字符必须去掉，否则可写出目录穿越或畸形响应头。
   */
  private safeFilename(name: string): string {
    const base = (name || 'package.zip').split(/[/\\]/).pop() ?? 'package.zip';
    const cleaned = base.replace(/[\r\n"]/g, '').trim();
    return cleaned.length > 0 ? cleaned.slice(0, 120) : 'package.zip';
  }

  private toView(r: {
    id: string;
    version: string;
    filename: string;
    sha256: string;
    fileSizeBytes: number;
    changelog: string | null;
    createdAt: Date;
  }): PackageView {
    return {
      id: r.id,
      version: r.version,
      filename: r.filename,
      sha256: r.sha256,
      fileSizeBytes: r.fileSizeBytes,
      changelog: r.changelog,
      createdAt: r.createdAt,
    };
  }
}
