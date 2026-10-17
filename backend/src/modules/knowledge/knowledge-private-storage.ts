import { BadRequestException, UnsupportedMediaTypeException } from '@nestjs/common';
import { createHash, randomUUID } from 'crypto';
import * as fs from 'fs/promises';
import type { Dir } from 'fs';
import * as path from 'path';

/** Originals are never served by the public uploads middleware. */
export class KnowledgePrivateStorage {
  private readonly root = path.resolve(process.env.KNOWLEDGE_PRIVATE_PATH || path.join(process.cwd(), 'private', 'knowledge'));

  async prepare(file: Express.Multer.File) {
    const data = file.buffer ?? (file.path ? await fs.readFile(file.path) : null);
    if (!data?.length) throw new BadRequestException({ code: 'VALIDATION_ERROR', message: '不能上传空文件' });
    if (data.length !== file.size || data.length > 10 * 1024 * 1024) {
      throw new BadRequestException({ code: 'VALIDATION_ERROR', message: '文件大小无效或超过 10MB' });
    }
    const extension = path.extname(file.originalname).toLowerCase();
    const types = { '.txt': 'text/plain', '.md': 'text/markdown', '.pdf': 'application/pdf',
      '.docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' };
    if (types[extension] !== file.mimetype ||
      (extension === '.pdf' && !data.subarray(0, 5).equals(Buffer.from('%PDF-'))) ||
      (extension === '.docx' && !data.subarray(0, 4).equals(Buffer.from([80, 75, 3, 4]))) ||
      (['.txt', '.md'].includes(extension) && (data.includes(0) || !this.validUtf8(data)))) {
      throw new UnsupportedMediaTypeException({ code: 'UNSUPPORTED_FORMAT', message: '文件内容与格式不匹配，支持 PDF、DOCX、UTF-8 TXT 和 Markdown' });
    }
    return { data, sha256: createHash('sha256').update(data).digest('hex'),
      originalName: path.basename(file.originalname).slice(0, 255), mimeType: file.mimetype, fileSize: data.length };
  }

  async write(data: Buffer) {
    await fs.mkdir(this.root, { recursive: true, mode: 0o700 });
    const storagePath = path.join(this.root, randomUUID());
    const handle = await fs.open(storagePath, 'wx', 0o600);
    try {
      try { await handle.writeFile(data); await handle.sync(); } finally { await handle.close(); }
      const directory = await fs.open(this.root, 'r');
      try { await directory.sync(); } finally { await directory.close(); }
      return storagePath;
    } catch (error) {
      await this.remove(storagePath);
      throw error;
    }
  }

  async remove(storagePath: string) {
    try { await fs.unlink(storagePath); } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
  }

  /** The grace period exceeds request lifetimes; only our own UUID originals are eligible. */
  async sweepUnreferenced(isReferenced: (storagePath: string) => Promise<boolean>, now = Date.now()) {
    let directory: Dir;
    try { directory = await fs.opendir(this.root); }
    catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return 0; throw error; }
    let removed = 0;
    let scanned = 0;
    for await (const entry of directory) {
      if (++scanned > 10000 || removed >= 100) break;
      if (!entry.isFile() || !/^[a-f0-9-]{36}$/.test(entry.name)) continue;
      const storagePath = path.join(this.root, entry.name);
      let stat: Awaited<ReturnType<typeof fs.stat>>;
      try { stat = await fs.stat(storagePath); }
      catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') continue; throw error; }
      if (now - stat.mtimeMs < 24 * 60 * 60 * 1000 || await isReferenced(storagePath)) continue;
      await this.remove(storagePath);
      removed++;
    }
    return removed;
  }

  private validUtf8(data: Buffer) {
    try { new TextDecoder('utf-8', { fatal: true }).decode(data); return true; } catch { return false; }
  }
}
