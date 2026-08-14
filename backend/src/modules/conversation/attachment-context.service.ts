import { Injectable, Logger } from '@nestjs/common';
import type { MessageAttachment } from 'shared';
import { StorageService } from '../upload/storage/storage.service';
import { DocumentParserService } from '../knowledge/document-parser.service';
import { mkdtemp, rm, writeFile } from 'fs/promises';
import { tmpdir } from 'os';
import { join } from 'path';

/** 单个文档注入提示词的正文上限，超出截断（约等于 3k~5k token） */
const MAX_DOC_CHARS = 12000;

/** 单张图片允许传给模型的字节上限；超过就退化成文字描述 */
const MAX_IMAGE_BYTES = 8 * 1024 * 1024;

/** AI SDK 的 user message 内容部件（图片走 image part，文本走 text part） */
export type UserContentPart =
  | { type: 'text'; text: string }
  | { type: 'image'; image: Buffer; mediaType: string };

export interface AttachmentContext {
  /** 附加到 user message 的内容部件（图片字节 + 文档正文摘要） */
  parts: UserContentPart[];
  /** 供日志/调试用的简述 */
  summary: string;
}

/**
 * 把消息附件转换成模型能真正读到的内容。
 *
 * 两条路径：
 * - 图片 → 以字节形式作为 image part 交给多模态模型（不能传 URL：
 *   本地驱动的签名链接指向 localhost，上游模型访问不到）
 * - 文档 → 抽取正文，以文本形式注入（复用知识库那套解析器）
 *
 * 视频只注入文件名说明 —— 当前上游模型不吃视频，硬塞只会浪费 token。
 */
@Injectable()
export class AttachmentContextService {
  private readonly logger = new Logger(AttachmentContextService.name);

  constructor(
    private readonly storage: StorageService,
    private readonly documentParser: DocumentParserService,
  ) {}

  async build(
    attachments: MessageAttachment[],
    options: { includeImageBytes: boolean },
  ): Promise<AttachmentContext> {
    if (!attachments || attachments.length === 0) {
      return { parts: [], summary: '' };
    }

    const parts: UserContentPart[] = [];
    const notes: string[] = [];

    for (const att of attachments) {
      try {
        if (att.type === 'image') {
          if (!options.includeImageBytes) {
            notes.push(`[历史图片：${att.name}]`);
            continue;
          }
          if (att.size > MAX_IMAGE_BYTES) {
            notes.push(`[图片 ${att.name} 过大（${formatSize(att.size)}），未提交给模型]`);
            continue;
          }
          const buffer = await this.storage.get(att.key);
          parts.push({
            type: 'image',
            image: buffer,
            mediaType: att.mimeType || 'image/png',
          });
          notes.push(`[图片：${att.name}]`);
        } else if (att.type === 'document') {
          const text = await this.extractDocumentText(att);
          if (text) {
            parts.push({
              type: 'text',
              text: `\n\n<附件 name="${att.name}" type="document">\n${text}\n</附件>`,
            });
            notes.push(`[文档：${att.name}（已解析 ${text.length} 字）]`);
          } else {
            parts.push({
              type: 'text',
              text: `\n\n[用户上传了文档「${att.name}」（${formatSize(att.size)}），但正文无法解析]`,
            });
            notes.push(`[文档：${att.name}（解析失败）]`);
          }
        } else {
          // 视频：只告知存在，不注入内容
          parts.push({
            type: 'text',
            text: `\n\n[用户上传了视频「${att.name}」（${formatSize(att.size)}），当前模型无法直接观看其内容]`,
          });
          notes.push(`[视频：${att.name}]`);
        }
      } catch (err) {
        // 单个附件处理失败不该让整轮对话挂掉
        this.logger.warn(
          `附件 ${att.key} 处理失败：${(err as Error).message}`,
        );
        parts.push({
          type: 'text',
          text: `\n\n[附件「${att.name}」读取失败]`,
        });
      }
    }

    return { parts, summary: notes.join(' ') };
  }

  /**
   * 抽取文档正文。
   *
   * DocumentParserService 只接受文件路径（知识库那边文件本来就在磁盘上），
   * 而这里的字节可能来自 OSS，所以先落到临时文件再解析，用完即删。
   * 纯文本类直接按 UTF-8 解码，省掉一次磁盘往返。
   */
  private async extractDocumentText(
    att: MessageAttachment,
  ): Promise<string | null> {
    const buffer = await this.storage.get(att.key);
    const mime = att.mimeType || '';

    if (
      mime.startsWith('text/') ||
      /\.(txt|md|csv)$/i.test(att.name)
    ) {
      return truncate(buffer.toString('utf-8'));
    }

    let dir: string | null = null;
    try {
      dir = await mkdtemp(join(tmpdir(), 'sep-att-'));
      const filePath = join(dir, att.name);
      await writeFile(filePath, buffer);
      const parsed = await this.documentParser.parseDocument(filePath, mime);
      return truncate(parsed.text ?? '');
    } catch (err) {
      this.logger.warn(
        `文档解析失败 ${att.name} (${mime})：${(err as Error).message}`,
      );
      return null;
    } finally {
      if (dir) await rm(dir, { recursive: true, force: true }).catch(() => {});
    }
  }
}

function truncate(text: string): string {
  const trimmed = text.trim();
  if (trimmed.length <= MAX_DOC_CHARS) return trimmed;
  return `${trimmed.slice(0, MAX_DOC_CHARS)}\n…（正文过长，已截断）`;
}

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}
