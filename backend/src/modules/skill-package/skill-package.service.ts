import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as crypto from 'crypto';
import { mkdir, readFile, writeFile } from 'fs/promises';
import { basename, join, resolve, sep } from 'path';
import AdmZip from 'adm-zip';
import matter from 'gray-matter';

/** zip 自身字节上限。包里只装 SKILL.md 与少量附件，20MB 足够且能挡住误传大文件。 */
export const SKILL_PACKAGE_MAX_BYTES = 20 * 1024 * 1024;
/** 解压后总字节上限 —— 压缩比炸弹（几 KB 解出几 GB）只能靠这条拦。 */
const MAX_UNCOMPRESSED_BYTES = 64 * 1024 * 1024;
/** 条目数上限，防止上万个空条目把解析拖死。 */
const MAX_ENTRIES = 500;
/** SKILL.md 正文上限 */
const MAX_SKILL_MARKDOWN_BYTES = 500 * 1024;
/** 包里必须存在的入口文件；按 basename 精确匹配，不能用 endsWith（会误收 NOTSKILL.md）。 */
const SKILL_ENTRY_NAME = 'SKILL.md';
/** zip 魔数 PK\x03\x04。只看扩展名会被改名的任意文件骗过。 */
const ZIP_MAGIC = [0x50, 0x4b, 0x03, 0x04];

/** 按 sha256 重新解包得到的内容 —— 全部字段都从 zip 本身推导，不含客户端输入。 */
export interface SkillPackageContent {
  /** 存储 key，`skills/<sha256>.zip` */
  key: string;
  sha256: string;
  fileCount: number;
  /** zip 自身字节数 */
  totalBytes: number;
  /** SKILL.md 剥掉 frontmatter 的正文 */
  content: string;
  /** frontmatter 里可用于预填能力信息的字段 */
  suggested: { name: string | null; description: string | null };
}

export interface StoredSkillPackage extends SkillPackageContent {
  /** 上传时的原始文件名。仅用于展示，真正的定位靠 sha256。 */
  filename: string;
}

/**
 * SKILL 包（zip）的解析与内容寻址存储。
 *
 * 内容寻址（文件名即 sha256）带来两个性质，上层依赖它们：
 *   1. 同一份包重复上传只落一次盘；
 *   2. 拿着 sha256 就能重新取回**当初校验过的那份正文** —— 所以创建能力时
 *      服务端从这里重读正文，而不是接受客户端回传，否则可以拿 A 包的哈希
 *      配 B 包的正文绕过自动校验。
 *
 * 故意不依赖 CapabilityValidatorService：解析与业务校验分属两层，
 * 由调用方组合（见 CapabilityContributionController.uploadSkillPackage）。
 */
@Injectable()
export class SkillPackageService {
  private readonly root: string;

  constructor(private readonly config: ConfigService) {
    this.root = resolve(
      this.config.get<string>('SKILL_PACKAGE_DIR') || './uploads/skills',
    );
  }

  /** 解析并落盘。已存在同 sha256 的包时跳过写入。 */
  async store(file: Express.Multer.File): Promise<StoredSkillPackage> {
    if (!file?.buffer?.length) throw new BadRequestException('未上传文件');
    if (!/\.zip$/i.test(file.originalname)) {
      throw new BadRequestException('只支持 .zip 文件');
    }
    if (file.buffer.length > SKILL_PACKAGE_MAX_BYTES) {
      throw new BadRequestException(
        `包不能超过 ${Math.floor(SKILL_PACKAGE_MAX_BYTES / 1024 / 1024)}MB`,
      );
    }
    this.assertZipMagic(file.buffer);

    const sha256 = crypto.createHash('sha256').update(file.buffer).digest('hex');
    const parsed = this.parse(file.buffer, sha256);

    await mkdir(this.root, { recursive: true });
    // wx：已存在就不重写。内容寻址下同名即同内容，重写只是浪费 IO。
    try {
      await writeFile(this.resolveStoredPath(parsed.key), file.buffer, { flag: 'wx' });
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
    }

    return { ...parsed, filename: this.sanitizeFilename(file.originalname) };
  }

  /**
   * 按 sha256 取回已上传的包并重新提取正文。
   * 创建能力 / 发布新版本时走这条路，正文来源永远是磁盘上那份字节。
   */
  async read(sha256: string): Promise<SkillPackageContent> {
    if (!/^[0-9a-f]{64}$/.test(sha256)) {
      throw new BadRequestException('sha256 格式非法');
    }
    const key = this.keyFor(sha256);
    let buffer: Buffer;
    try {
      buffer = await readFile(this.resolveStoredPath(key));
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
        throw new NotFoundException('上传的 SKILL 包不存在或已过期，请重新上传');
      }
      throw error;
    }
    return this.parse(buffer, sha256);
  }

  /**
   * key → 绝对路径。
   * key 只应来自我们自己写入的 DB 字段（SkillVersion.packageKey、
   * Capability.metadata.zipPath），但仍然按不可信输入处理：先要求 `skills/`
   * 前缀，再校验解析结果没有跑出存储根。少了前缀这层，一个被改写的 key
   * 就能读到 uploads/ 下别的子目录。
   */
  resolveStoredPath(key: string): string {
    const normalized = key.replace(/\\/g, '/');
    if (!normalized.startsWith('skills/')) {
      throw new BadRequestException('非法的存储路径');
    }
    const target = resolve(join(this.root, normalized.slice('skills/'.length)));
    if (target !== this.root && !target.startsWith(this.root + sep)) {
      throw new BadRequestException('非法的存储路径');
    }
    return target;
  }

  private keyFor(sha256: string) {
    return `skills/${sha256}.zip`;
  }

  /** 纯解析，无 IO。store 与 read 共用同一套校验，两条路径的结论不会漂移。 */
  private parse(buffer: Buffer, sha256: string): SkillPackageContent {
    const entries = new AdmZip(buffer).getEntries();
    const files = entries.filter((entry) => !entry.isDirectory);

    if (entries.length > MAX_ENTRIES) {
      throw new BadRequestException(`包内条目不能超过 ${MAX_ENTRIES} 个`);
    }
    for (const entry of entries) {
      this.assertSafeEntryName(entry.entryName);
    }
    const uncompressed = files.reduce((sum, entry) => sum + entry.header.size, 0);
    if (uncompressed > MAX_UNCOMPRESSED_BYTES) {
      throw new BadRequestException(
        `解压后体积超过 ${Math.floor(MAX_UNCOMPRESSED_BYTES / 1024 / 1024)}MB，请精简包内容`,
      );
    }

    const skillEntry = files.find(
      (entry) => basename(entry.entryName) === SKILL_ENTRY_NAME,
    );
    if (!skillEntry) throw new BadRequestException('包内必须包含 SKILL.md');
    if (skillEntry.header.size > MAX_SKILL_MARKDOWN_BYTES) {
      throw new BadRequestException('SKILL.md 不能超过 500KB');
    }

    const raw = skillEntry.getData().toString('utf8');
    const parsed = matter(raw);
    const content = parsed.content.trimStart();
    if (!content.trim()) throw new BadRequestException('SKILL.md 正文不能为空');

    return {
      key: this.keyFor(sha256),
      sha256,
      fileCount: files.length,
      totalBytes: buffer.length,
      content,
      suggested: {
        name: this.readFrontmatterString(parsed.data, 'name', 100),
        description: this.readFrontmatterString(parsed.data, 'description', 2000),
      },
    };
  }

  private assertZipMagic(buffer: Buffer) {
    const matched =
      buffer.length >= ZIP_MAGIC.length &&
      ZIP_MAGIC.every((byte, index) => buffer[index] === byte);
    if (!matched) throw new BadRequestException('文件内容不是有效的 zip');
  }

  /**
   * 拒绝会写到解压目录之外的条目名。这里只解析内存里的 zip、不落盘解压，
   * 但包会被下发给客户端与 OpenCode 服务解压，恶意条目名必须在入口就拦掉。
   */
  private assertSafeEntryName(entryName: string) {
    const normalized = entryName.replace(/\\/g, '/');
    const unsafe =
      normalized.startsWith('/') ||
      /^[a-zA-Z]:/.test(normalized) ||
      normalized.split('/').includes('..');
    if (unsafe) {
      throw new BadRequestException(`包内条目名非法：${entryName}`);
    }
  }

  /** 只取展示用的文件名：去掉路径分隔符，限长，保留 .zip 后缀。 */
  private sanitizeFilename(original: string) {
    const name = basename(original.replace(/\\/g, '/')).slice(-120);
    return name || 'package.zip';
  }

  private readFrontmatterString(
    data: Record<string, unknown>,
    key: string,
    maxLength: number,
  ): string | null {
    const value = data?.[key];
    if (typeof value !== 'string') return null;
    const trimmed = value.trim();
    return trimmed ? trimmed.slice(0, maxLength) : null;
  }
}
