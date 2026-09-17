import { BadRequestException, Injectable, Logger, NotFoundException, PayloadTooLargeException } from '@nestjs/common';
import { randomUUID } from 'crypto';
import { extname } from 'path';
import { PrismaService } from '../../prisma/prisma.service';
import { StorageService } from '../upload/storage/storage.service';
import { validateUploadedFile } from '../upload/file-validator';
import { EnterpriseContextService } from './enterprise-context.service';

export const MAX_ENTERPRISE_LOGO_SIZE = 2 * 1024 * 1024;
const LOGO_PATH = '/api/enterprise/logos/';
const LOGO_FILENAME = /^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}\.(png|jpg|jpeg|webp)$/;

@Injectable()
export class EnterpriseLogoService {
  private readonly logger = new Logger(EnterpriseLogoService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly context: EnterpriseContextService,
    private readonly storage: StorageService,
  ) {}

  async upload(userId: string, file?: Express.Multer.File): Promise<{ logo: string }> {
    const ctx = await this.context.resolve(userId);
    this.context.assertEnterpriseAdmin(ctx);
    if (!file?.buffer?.length) throw new BadRequestException('请选择企业头像图片');
    if (file.buffer.length > MAX_ENTERPRISE_LOGO_SIZE || file.size > MAX_ENTERPRISE_LOGO_SIZE) {
      throw new PayloadTooLargeException('企业头像不能超过 2MB');
    }
    const extension = extname(file.originalname).toLowerCase();
    if (!['.png', '.jpg', '.jpeg', '.webp'].includes(extension)) {
      throw new BadRequestException('企业头像仅支持 PNG、JPEG、WebP 图片');
    }
    const validated = validateUploadedFile({ ...file, size: file.buffer.length });
    const filename = `${randomUUID()}.${validated.ext}`;
    const key = `enterprise-logos/${filename}`;
    const logo = `${LOGO_PATH}${filename}`;
    // Reuse the configured local/OSS driver, but never persist its expiring signed URL.
    await this.storage.put({ key, buffer: file.buffer, mime: validated.mime, filename });
    try {
      await this.prisma.enterprise.update({ where: { id: ctx.enterpriseId }, data: { logo } });
    } catch (error) {
      await this.storage.delete(key).catch(() => this.logger.warn('企业头像保存失败后的文件清理失败'));
      throw error;
    }
    return { logo };
  }

  async read(filename: string): Promise<{ buffer: Buffer; mime: string }> {
    if (!LOGO_FILENAME.test(filename)) throw new NotFoundException('企业头像不存在');
    // Only explicitly published enterprise logos are public; arbitrary attachment keys are never exposed.
    const enterprise = await this.prisma.enterprise.findFirst({
      where: { logo: `${LOGO_PATH}${filename}` }, select: { id: true },
    });
    if (!enterprise) throw new NotFoundException('企业头像不存在');
    const buffer = await this.storage.get(`enterprise-logos/${filename}`);
    const extension = extname(filename);
    return { buffer, mime: extension === '.png' ? 'image/png' : extension === '.webp' ? 'image/webp' : 'image/jpeg' };
  }
}
