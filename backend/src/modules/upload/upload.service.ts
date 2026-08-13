import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  Logger,
} from '@nestjs/common';
import { EnterpriseContextService } from '../enterprise/enterprise-context.service';
import { validateUploadedFile } from './file-validator';
import { StorageService } from './storage/storage.service';
import { MAX_FILES_PER_REQUEST } from './upload.constants';
import type { UploadedAttachment } from './upload.types';

@Injectable()
export class UploadService {
  private readonly logger = new Logger(UploadService.name);

  constructor(
    private readonly storage: StorageService,
    private readonly enterpriseContext: EnterpriseContextService,
  ) {}

  /**
   * 校验并存储一批文件，返回可直接放进消息 attachments 的记录。
   *
   * 逐个串行处理而非 Promise.all：单次最多 5 个文件，串行的收益是
   * 出错时不会留下一半已上传的孤儿对象（第一个失败即整体抛错，
   * 已写入的对象由下面的补偿逻辑清掉）。
   */
  async uploadFiles(
    files: Express.Multer.File[],
    userId: string,
  ): Promise<UploadedAttachment[]> {
    if (!files || files.length === 0) {
      throw new BadRequestException('未接收到文件');
    }
    if (files.length > MAX_FILES_PER_REQUEST) {
      throw new BadRequestException(
        `单次最多上传 ${MAX_FILES_PER_REQUEST} 个文件`,
      );
    }

    // enterpriseId 只能由服务端解析，不接受前端传入 —— 否则存储隔离形同虚设
    const ctx = await this.enterpriseContext.resolveOrNull(userId);
    const enterpriseId = ctx?.enterpriseId ?? null;

    const uploaded: UploadedAttachment[] = [];

    try {
      for (const file of files) {
        const validated = validateUploadedFile(file);
        const key = this.storage.buildKey({
          enterpriseId,
          userId,
          safeName: validated.safeName,
        });

        const stored = await this.storage.put({
          key,
          buffer: file.buffer,
          mime: validated.mime,
          filename: validated.safeName,
        });

        uploaded.push({
          type: validated.kind,
          key: stored.key,
          url: stored.url,
          name: validated.safeName,
          size: stored.size,
          mimeType: validated.mime,
        });
      }
    } catch (err) {
      // 补偿：把本批已经落盘/落 OSS 的对象删掉，避免留下无人引用的文件
      await Promise.all(
        uploaded.map((a) =>
          this.storage.delete(a.key).catch((e) => {
            this.logger.warn(`回滚删除失败 ${a.key}: ${(e as Error).message}`);
          }),
        ),
      );
      throw err;
    }

    this.logger.log(
      `用户 ${userId} 上传 ${uploaded.length} 个文件（driver=${this.storage.driverName}）`,
    );
    return uploaded;
  }

  /** 为已存储的对象重新签发访问地址（历史消息里的链接过期后用）。 */
  async refreshUrl(key: string, userId: string): Promise<string> {
    await this.assertOwnership([key], userId);
    return this.storage.getSignedUrl(key);
  }

  /**
   * 校验这些存储键确实属于该用户。
   *
   * 附件是前端回传的 —— 上传接口返回什么，发消息时就带什么。若不校验，
   * 用户可以把别人的 key 塞进自己的消息，借重签接口拿到有效链接。
   * 键的前两段固定为 `{scope}/{userId}/`（见 StorageService.buildKey），
   * 比对这个前缀即可，无需额外查库。
   */
  async assertOwnership(keys: string[], userId: string): Promise<void> {
    if (keys.length === 0) return;

    const ctx = await this.enterpriseContext.resolveOrNull(userId);
    const expectedPrefix = `${ctx?.enterpriseId ?? 'personal'}/${userId}/`;

    const foreign = keys.filter((k) => !k.startsWith(expectedPrefix));
    if (foreign.length > 0) {
      this.logger.warn(
        `用户 ${userId} 引用了不属于自己的附件：${foreign.join(', ')}`,
      );
      throw new ForbiddenException('附件不存在或无权访问');
    }
  }
}
