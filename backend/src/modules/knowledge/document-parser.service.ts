import { Injectable, Logger } from '@nestjs/common';
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

@Injectable()
export class DocumentParserService {
  private readonly logger = new Logger(DocumentParserService.name);

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
