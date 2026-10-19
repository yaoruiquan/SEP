import {
  BadRequestException,
  Injectable,
  PayloadTooLargeException,
  RequestTimeoutException,
  UnprocessableEntityException,
  UnsupportedMediaTypeException,
} from '@nestjs/common';
import { Worker } from 'node:worker_threads';
import { createRequire } from 'node:module';

export interface ParsedBlock {
  /** Zero-based document order; page numbers, when known, are one-based. */
  ordinal: number;
  text: string;
  page: number | null;
  section?: string | null;
}

export interface ParsedDocument {
  text: string;
  blocks: ParsedBlock[];
  metadata?: { pages?: number; title?: string; author?: string };
}

export interface DocumentParserLimits {
  timeoutMs: number;
  maxFileBytes: number;
  maxZipBytes: number;
  maxZipEntries: number;
  maxPages: number;
}

const LIMITS: Readonly<DocumentParserLimits> = {
  timeoutMs: 30_000,
  maxFileBytes: 20 * 1024 * 1024,
  maxZipBytes: 50 * 1024 * 1024,
  maxZipEntries: 2000,
  maxPages: 2000,
};

// Self-contained so the same worker runs from both TypeScript tests and compiled JS.
async function parseInWorker(nativeRequire: NodeRequire): Promise<void> {
  const { parentPort, workerData } = nativeRequire('node:worker_threads') as typeof import('node:worker_threads');
  const { open } = nativeRequire('node:fs/promises') as typeof import('node:fs/promises');
  const { filePath, mimeType, limits, modules } = workerData as {
    filePath: string;
    mimeType: string;
    limits: DocumentParserLimits;
    modules: { pdf: string; mammoth: string; zip: string };
  };
  const fail = (code: string): never => { throw new Error(code); };
  try {
    const file = await open(filePath, 'r');
    let buffer: Buffer;
    try {
      const stat = await file.stat();
      if (!stat.isFile()) fail('INVALID');
      if (stat.size > limits.maxFileBytes) fail('LIMIT');
      // Bounded reads also protect against a file growing after stat().
      const data = Buffer.alloc(stat.size + 1);
      let length = 0;
      while (length < data.length) {
        const { bytesRead } = await file.read(data, length, data.length - length, null);
        if (!bytesRead) break;
        length += bytesRead;
      }
      if (length > stat.size) fail('LIMIT');
      buffer = data.subarray(0, length);
    } finally {
      await file.close();
    }

    let result: ParsedDocument;
    if (mimeType === 'application/pdf') {
      const { PDFParse } = nativeRequire(modules.pdf) as typeof import('pdf-parse');
      class NoExternalResource {
        async fetch(): Promise<never> { return fail('EXTERNAL_RESOURCE'); }
      }
      const parser = new PDFParse({
        data: new Uint8Array(buffer),
        isEvalSupported: false,
        useWorkerFetch: false,
        useWasm: false,
        useSystemFonts: false,
        disableFontFace: true,
        CMapReaderFactory: NoExternalResource,
        StandardFontDataFactory: NoExternalResource,
        WasmFactory: NoExternalResource,
      });
      try {
        const info = await parser.getInfo();
        if (info.total > limits.maxPages) fail('LIMIT');
        const parsed = await parser.getText({ pageJoiner: '' });
        const blocks = parsed.pages.map((page, ordinal) => ({
          ordinal, text: page.text, page: page.num,
        }));
        result = {
          text: blocks.map((block) => block.text).join('\n\n'),
          blocks,
          metadata: {
            pages: parsed.total,
            ...(typeof info.info?.Title === 'string' ? { title: info.info.Title } : {}),
            ...(typeof info.info?.Author === 'string' ? { author: info.info.Author } : {}),
          },
        };
      } finally {
        await parser.destroy();
      }
    } else {
      let text: string;
      if (mimeType.startsWith('text/')) {
        text = buffer.toString('utf8');
      } else {
        const AdmZip = nativeRequire(modules.zip) as typeof import('adm-zip');
        const { inflateRawSync } = nativeRequire('node:zlib') as typeof import('node:zlib');
        const zip = new AdmZip(buffer);
        const entries = zip.getEntries();
        if (entries.length > limits.maxZipEntries) fail('LIMIT');
        const safeZip = new AdmZip();
        const names = new Set<string>();
        let total = 0;
        for (const entry of entries) {
          const name = entry.entryName;
          if (names.has(name) || name.startsWith('/') || name.includes('\\') ||
              name.split('/').some((part) => part === '..' || part === '.') ||
              entry.header.flags & 1) fail('INVALID');
          names.add(name);
          if (entry.isDirectory) continue;
          const remaining = limits.maxZipBytes - total;
          if (entry.header.size > remaining) fail('LIMIT');
          const compressed = entry.getCompressedData();
          let data: Buffer;
          if (entry.header.method === 0) {
            data = compressed;
          } else if (entry.header.method === 8) {
            // Never trust the ZIP's declared size when allocating inflated output.
            data = inflateRawSync(compressed, {
              maxOutputLength: Math.min(remaining, entry.header.size) + 1,
            });
          } else {
            fail('INVALID');
          }
          if (data.length > remaining) fail('LIMIT');
          if (data.length !== entry.header.size) fail('INVALID');
          total += data.length;
          if (/\.(xml|rels)$/i.test(name) && /<!DOCTYPE|<!ENTITY/i.test(data.toString('utf8'))) {
            fail('EXTERNAL_RESOURCE');
          }
          safeZip.addFile(name, data);
        }
        if (!names.has('[Content_Types].xml') || !names.has('word/document.xml')) fail('INVALID');
        const mammoth = nativeRequire(modules.mammoth) as typeof import('mammoth');
        // extractRawText accepts one argument. Buffer input and the library's
        // default externalFileAccess=false prevent external file/image reads.
        text = (await mammoth.extractRawText({ buffer: safeZip.toBuffer() })).value;
      }
      result = { text, blocks: [{ ordinal: 0, text, page: null }] };
    }
    parentPort.postMessage({ result });
  } catch (error) {
    const code = error instanceof Error ? error.message : '';
    parentPort.postMessage({ error: ['LIMIT', 'EXTERNAL_RESOURCE'].includes(code) ? code : 'INVALID' });
  }
}

@Injectable()
export class DocumentParserService {
  async parseDocument(
    filePath: string,
    mimeType: string,
    options: Partial<DocumentParserLimits> = {},
  ): Promise<ParsedDocument> {
    if (!['application/pdf', 'text/plain', 'text/markdown',
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document'].includes(mimeType)) {
      throw new UnsupportedMediaTypeException('Only PDF, TXT, Markdown and DOCX are supported');
    }
    const limits = { ...LIMITS };
    for (const key of Object.keys(options) as (keyof DocumentParserLimits)[]) {
      if (!(key in LIMITS) || !Number.isSafeInteger(options[key]) ||
          options[key] <= 0 || options[key] > LIMITS[key]) {
        throw new BadRequestException(`Invalid parser limit: ${key}`);
      }
      limits[key] = options[key];
    }
    // Inject Node's require in the worker realm; Webpack's loader cannot be serialized.
    const runtimeRequire = createRequire(__filename);
    const worker = new Worker(`(${parseInWorker.toString()})(require)`, {
      eval: true,
      workerData: {
        filePath, mimeType, limits,
        modules: {
          pdf: runtimeRequire.resolve('pdf-parse'),
          mammoth: runtimeRequire.resolve('mammoth'),
          zip: runtimeRequire.resolve('adm-zip'),
        },
      },
      resourceLimits: { maxOldGenerationSizeMb: 256, stackSizeMb: 8 },
    });
    let timer: ReturnType<typeof setTimeout>;
    try {
      return await new Promise<ParsedDocument>((resolve, reject) => {
        timer = setTimeout(() => reject(new RequestTimeoutException('Document parsing timed out')), limits.timeoutMs);
        worker.once('message', (message: { result?: ParsedDocument; error?: string }) => {
          if (message.error === 'LIMIT') {
            reject(new PayloadTooLargeException('Document exceeds parsing limits'));
          } else if (message.error) {
            reject(new UnprocessableEntityException('Document could not be parsed safely'));
          } else {
            resolve(message.result);
          }
        });
        worker.once('error', () => reject(new UnprocessableEntityException('Document parser failed')));
        worker.once('exit', () => reject(new UnprocessableEntityException('Document parser exited')));
      });
    } finally {
      clearTimeout(timer);
      await worker.terminate();
    }
  }

  cleanText(text: string): string {
    return text.replace(/\r\n?/g, '\n')
      .split('\n').map((line) => line.trim()).join('\n')
      .replace(/\n{3,}/g, '\n\n').trim();
  }
}
