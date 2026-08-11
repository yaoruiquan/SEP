import { Injectable } from '@nestjs/common';

/**
 * 文本分词服务
 * 使用 Node.js v26.5+ 自带的 Intl.Segmenter 进行中文分词
 */
@Injectable()
export class TextTokenizer {
  private wordSegmenter: any; // Intl.Segmenter
  private sentenceSegmenter: any; // Intl.Segmenter

  constructor() {
    // @ts-ignore - Intl.Segmenter 在 Node.js v16.6+ 可用，但 TypeScript 类型定义可能未更新
    this.wordSegmenter = new Intl.Segmenter('zh-CN', { granularity: 'word' });
    // @ts-ignore
    this.sentenceSegmenter = new Intl.Segmenter('zh-CN', { granularity: 'sentence' });
  }

  /**
   * 分词：将文本分解为词语数组
   */
  tokenize(text: string): string[] {
    if (!text || text.trim().length === 0) {
      return [];
    }

    const tokens: string[] = [];
    const segments = this.wordSegmenter.segment(text);

    for (const segment of segments) {
      // 过滤标点和空白
      const word = segment.segment.trim();
      if (word.length > 0 && segment.isWordLike) {
        tokens.push(word.toLowerCase());
      }
    }

    return tokens;
  }

  /**
   * 分句：将文本分解为句子数组
   */
  sentenceSplit(text: string): string[] {
    if (!text || text.trim().length === 0) {
      return [];
    }

    const sentences: string[] = [];
    const segments = this.sentenceSegmenter.segment(text);

    for (const segment of segments) {
      const sentence = segment.segment.trim();
      if (sentence.length > 0) {
        sentences.push(sentence);
      }
    }

    return sentences;
  }

  /**
   * 估算文本的 token 数量
   * 中文：~1.5 字符 = 1 token
   * 英文：~4 字符 = 1 token
   */
  estimateTokens(text: string): number {
    const chineseChars = (text.match(/[一-龥]/g) || []).length;
    const otherChars = text.length - chineseChars;
    return Math.ceil(chineseChars / 1.5 + otherChars / 4);
  }
}
