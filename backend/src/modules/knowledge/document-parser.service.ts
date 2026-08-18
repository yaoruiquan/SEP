import { Injectable, Logger, OnModuleDestroy } from '@nestjs/common';
import * as fs from 'fs/promises';
import * as pdfParse from 'pdf-parse';
import * as mammoth from 'mammoth';

export interface ParsedDocument {
  text: string;
  metadata?: {
    pages?: number;
    title?: string;
    author?: string;
  };
}

/**
 * tesseract.js Worker 的最小结构类型。
 * 避免在文件头静态 import tesseract.js（体积大、初始化有下载成本），
 * 只在真正解析图片时才动态加载，并用结构类型约束其关键方法。
 */
interface OcrWorker {
  recognize(input: Buffer | string): Promise<{ data: { text: string } }>;
  terminate(): Promise<unknown>;
}

@Injectable()
export class DocumentParserService implements OnModuleDestroy {
  private readonly logger = new Logger(DocumentParserService.name);

  /** 惰性单例 OCR worker（chi_sim+eng），避免每次解析图片都重新初始化/下载 */
  private ocrWorkerPromise: Promise<OcrWorker> | null = null;

  /**
   * 解析文档文件
   */
  async parseDocument(filePath: string, mimeType: string): Promise<ParsedDocument> {
    try {
      switch (mimeType) {
        case 'application/pdf':
          return await this.parsePDF(filePath);

        case 'application/vnd.openxmlformats-officedocument.wordprocessingml.document':
        case 'application/msword':
          return await this.parseWord(filePath);

        case 'text/plain':
        case 'text/markdown':
          return await this.parseText(filePath);

        // Phase C1：图片 OCR → 复用现有文本管道
        case 'image/png':
        case 'image/jpeg':
        case 'image/jpg':
          return await this.parseImage(filePath);

        default:
          throw new Error(`Unsupported mime type: ${mimeType}`);
      }
    } catch (error) {
      this.logger.error(`Failed to parse document ${filePath}: ${error.message}`);
      throw error;
    }
  }

  /**
   * 解析 PDF 文件
   */
  private async parsePDF(filePath: string): Promise<ParsedDocument> {
    const dataBuffer = await fs.readFile(filePath);
    const data = await (pdfParse as any)(dataBuffer);

    return {
      text: data.text,
      metadata: {
        pages: data.numpages,
        title: data.info?.Title,
        author: data.info?.Author,
      },
    };
  }

  /**
   * 解析 Word 文件
   */
  private async parseWord(filePath: string): Promise<ParsedDocument> {
    const result = await mammoth.extractRawText({ path: filePath });

    if (result.messages.length > 0) {
      this.logger.warn(`Word parsing warnings: ${JSON.stringify(result.messages)}`);
    }

    return {
      text: result.value,
    };
  }

  /**
   * 解析纯文本文件
   */
  private async parseText(filePath: string): Promise<ParsedDocument> {
    const text = await fs.readFile(filePath, 'utf-8');

    return {
      text,
    };
  }

  /**
   * 解析图片（Phase C1：tesseract.js OCR，中文 chi_sim + 英文 eng）
   *
   * 提取到的文本交给 processor 的 cleanText + chunkByParagraphs 与纯文本一致。
   * 若识别结果过短（<10 字符），由 processor 按现有规则拒绝，不产生空 chunk。
   */
  private async parseImage(filePath: string): Promise<ParsedDocument> {
    const buffer = await fs.readFile(filePath);
    const worker = await this.getOcrWorker();
    const { data } = await worker.recognize(buffer);

    return {
      text: data?.text ?? '',
    };
  }

  /**
   * 获取（惰性初始化）单例 OCR worker。
   * 初始化失败时重置 promise，允许下次重试。
   */
  private getOcrWorker(): Promise<OcrWorker> {
    if (!this.ocrWorkerPromise) {
      this.ocrWorkerPromise = (async () => {
        this.logger.log('Initializing OCR worker (tesseract.js chi_sim+eng)...');
        const { createWorker } = await import('tesseract.js');
        const worker = await createWorker('chi_sim+eng');
        this.logger.log('OCR worker ready');
        return worker as unknown as OcrWorker;
      })().catch((err) => {
        this.ocrWorkerPromise = null;
        throw err;
      });
    }
    return this.ocrWorkerPromise;
  }

  async onModuleDestroy() {
    if (this.ocrWorkerPromise) {
      try {
        const worker = await this.ocrWorkerPromise;
        await worker.terminate();
        this.logger.log('OCR worker terminated');
      } catch (e) {
        this.logger.warn(`Failed to terminate OCR worker: ${e.message}`);
      }
    }
  }

  /**
   * 清理解析后的文本
   * - 去除多余空白
   * - 规范化换行符
   */
  cleanText(text: string): string {
    return (
      text
        // 统一换行符
        .replace(/\r\n/g, '\n')
        // 去除页眉页脚常见模式
        .replace(/^\s*\d+\s*$/gm, '')
        // 去除多余空行（保留段落分隔）
        .replace(/\n{3,}/g, '\n\n')
        // 去除行首行尾空白
        .split('\n')
        .map((line) => line.trim())
        .join('\n')
        .trim()
    );
  }
}
