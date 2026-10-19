import { BadRequestException, ServiceUnavailableException } from '@nestjs/common';
import { readFile } from 'node:fs/promises';
import { isAbsolute, join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { createRequire } from 'node:module';

export class TokenizerUnavailableException extends ServiceUnavailableException {
  readonly code = 'TOKENIZER_UNAVAILABLE';
  readonly retryable = false;

  constructor() {
    super({
      code: 'TOKENIZER_UNAVAILABLE',
      message: 'Local embedding tokenizer is unavailable; configure matching tokenizer files and retry manually',
      retryable: false,
    });
  }
}

export interface TokenBudgetTokenizer {
  /** Persist this identifier alongside the embedding profile. */
  id: string;
  encode(text: string): ArrayLike<number>;
}

export interface TokenChunkOptions {
  maxTokens: number;
  overlapTokens?: number;
  reserveTokens?: number;
}

export interface TokenChunk {
  text: string;
  tokenCount: number;
  /** UTF-16 offsets into the unchanged source text. */
  startOffset: number;
  endOffset: number;
}

/**
 * 文本分块工具
 * 将长文本分割成适合向量化的小块
 */
export class TextChunker {
  private static tokenizer: TokenBudgetTokenizer | undefined;

  static resetTokenizer(): void {
    this.tokenizer = undefined;
  }

  static async initializeTokenizer(directory: string, id: string): Promise<void> {
    this.resetTokenizer();
    try {
      this.tokenizer = await this.loadTokenizer(directory, id);
    } catch {
      throw new TokenizerUnavailableException();
    }
  }

  /** Load only pre-provisioned local tokenizer files, never model weights or remote assets. */
  static async loadTokenizer(directory: string, id: string): Promise<TokenBudgetTokenizer> {
    if (!isAbsolute(directory) || !id?.trim()) {
      throw new BadRequestException('An absolute local tokenizer directory and identifier are required');
    }
    // Keep native ESM import under the backend's CommonJS TypeScript compilation.
    const importESM = new Function('url', 'return import(url)') as
      (url: string) => Promise<typeof import('@xenova/transformers')>;
    // Native resolution must survive Nest's Webpack bundle (require.resolve becomes a module ID).
    const runtimeRequire = createRequire(__filename);
    const { AutoTokenizer, PreTrainedTokenizer } = await importESM(pathToFileURL(runtimeRequire.resolve('@xenova/transformers')).href);
    const [definition, configuration] = await Promise.all([
      readFile(join(directory, 'tokenizer.json'), 'utf8').then((data) => JSON.parse(data)),
      readFile(join(directory, 'tokenizer_config.json'), 'utf8').then((data) => JSON.parse(data)),
    ]);
    // Match AutoTokenizer's local constructor selection without its global
    // localModelPath/cache resolution or any possibility of remote fallback.
    const name = configuration.tokenizer_class?.replace(/Fast$/, '') || 'PreTrainedTokenizer';
    const Tokenizer = name === 'PreTrainedTokenizer' ? PreTrainedTokenizer :
      AutoTokenizer.TOKENIZER_CLASS_MAPPING[name as keyof typeof AutoTokenizer.TOKENIZER_CLASS_MAPPING];
    if (!Tokenizer) throw new BadRequestException('Unsupported local tokenizer class');
    const tokenizer = new Tokenizer(definition, configuration);
    return {
      id,
      encode: (text) => tokenizer.encode(text, null, { add_special_tokens: true }),
    };
  }

  static countTokens(text: string, tokenizer: TokenBudgetTokenizer = this.tokenizer): number {
    if (!tokenizer?.id?.trim() || typeof tokenizer.encode !== 'function') {
      throw new TokenizerUnavailableException();
    }
    const count = tokenizer.encode(text).length;
    if (!Number.isSafeInteger(count) || count < 0 || (text.length > 0 && count === 0)) {
      throw new BadRequestException('Tokenizer returned an invalid token count');
    }
    return count;
  }

  static chunkByTokens(text: string, maxTokens = 800): Array<{ content: string; tokenCount: number }> {
    return this.chunkByTokenBudget(text, this.tokenizer, { maxTokens })
      .map(({ text: content, tokenCount }) => ({ content, tokenCount }));
  }

  static truncateToTokenBudget(text: string, maxTokens: number): { content: string; tokenCount: number } | null {
    if (maxTokens <= 0) return null;
    const tokenCount = this.countTokens(text);
    if (tokenCount <= maxTokens) return { content: text, tokenCount };
    const characters = Array.from(text);
    let low = 0;
    let high = characters.length;
    let best: { content: string; tokenCount: number } | null = null;
    // Every retained prefix is measured; no character/token ratio or UTF-16 splitting.
    while (low + 1 < high) {
      const middle = Math.floor((low + high) / 2);
      const content = characters.slice(0, middle).join('');
      const count = this.countTokens(content);
      if (count <= maxTokens) { low = middle; best = { content, tokenCount: count }; }
      else high = middle;
    }
    return best;
  }

  static chunkByTokenBudget(
    text: string,
    tokenizer: TokenBudgetTokenizer,
    options: TokenChunkOptions = { maxTokens: 512 },
  ): TokenChunk[] {
    const { maxTokens, overlapTokens = 0, reserveTokens = 0 } = options;
    if (![maxTokens, overlapTokens, reserveTokens].every(Number.isSafeInteger) ||
        maxTokens <= 0 || overlapTokens < 0 || reserveTokens < 0 ||
        reserveTokens >= maxTokens || overlapTokens >= maxTokens - reserveTokens) {
      throw new BadRequestException('Invalid token chunk budget or overlap');
    }
    if (!text?.trim()) return [];
    const budget = maxTokens - reserveTokens;
    // Boundaries are Unicode code points; do not split UTF-16 surrogate pairs.
    const offsets = [0];
    for (const character of text) offsets.push(offsets[offsets.length - 1] + character.length);
    const slice = (start: number, end: number) => text.slice(offsets[start], offsets[end]);
    const count = (start: number, end: number) => this.countTokens(slice(start, end), tokenizer);
    const chunks: TokenChunk[] = [];
    let start = 0;
    let previousEnd = 0;
    while (start < offsets.length - 1) {
      // Exponential probing keeps encoding work bounded to roughly one chunk.
      let low = start;
      let high = Math.min(start + 16, offsets.length - 1);
      while (count(start, high) <= budget) {
        low = high;
        if (high === offsets.length - 1) break;
        high = Math.min(start + (high - start) * 2, offsets.length - 1);
      }
      while (low + 1 < high) {
        const middle = Math.floor((low + high) / 2);
        if (count(start, middle) <= budget) low = middle;
        else high = middle;
      }
      const end = low;
      if (end <= previousEnd && start < previousEnd) {
        start = previousEnd;
        continue;
      }
      if (end <= start) {
        throw new BadRequestException('Token budget cannot fit the next Unicode code point');
      }
      chunks.push({ text: slice(start, end), tokenCount: count(start, end),
        startOffset: offsets[start], endOffset: offsets[end] });
      if (end === offsets.length - 1) break;
      previousEnd = end;
      const chunkStart = start;
      start = end;
      if (overlapTokens > 0) {
        let left = chunkStart + 1;
        let right = end;
        while (left < right) {
          const middle = Math.floor((left + right) / 2);
          if (count(middle, end) <= overlapTokens) right = middle;
          else left = middle + 1;
        }
        start = left;
      }
    }
    return chunks;
  }

  /**
   * 将文本分块
   * @param text 原始文本
   * @param chunkSize 块大小（字符数）
   * @param overlap 重叠大小（字符数）
   * @returns 文本块数组
   */
  static chunk(text: string, chunkSize: number = 1000, overlap: number = 100): string[] {
    if (!text || text.trim().length === 0) {
      return [];
    }

    // 清理文本：去除多余空白
    const cleanText = text.replace(/\s+/g, ' ').trim();

    // 如果文本小于块大小，直接返回
    if (cleanText.length <= chunkSize) {
      return [cleanText];
    }

    const chunks: string[] = [];
    let startIndex = 0;

    while (startIndex < cleanText.length) {
      let endIndex = startIndex + chunkSize;

      // 如果不是最后一块，尝试在句子或段落边界分割
      if (endIndex < cleanText.length) {
        endIndex = this.findBestBreakpoint(cleanText, startIndex, endIndex);
      }

      const chunk = cleanText.substring(startIndex, endIndex).trim();
      if (chunk.length > 0) {
        chunks.push(chunk);
      }

      // 下一块的起始位置考虑重叠
      startIndex = endIndex - overlap;

      // 确保不会陷入无限循环
      const lastChunkEnd = chunks.length > 0 ? chunks[chunks.length - 1].length : 0;
      if (startIndex <= lastChunkEnd) {
        startIndex = endIndex;
      }
    }

    return chunks;
  }

  /**
   * 找到最佳的分块边界
   * 优先在段落、句子、逗号等标点处分割
   */
  private static findBestBreakpoint(text: string, start: number, end: number): number {
    const searchRange = Math.min(200, Math.floor((end - start) * 0.2)); // 在末尾 20% 范围内搜索
    const searchStart = end - searchRange;

    // 优先级1: 段落边界（两个换行符）
    const paragraphBreak = text.lastIndexOf('\n\n', end);
    if (paragraphBreak > searchStart && paragraphBreak > start) {
      return paragraphBreak + 2;
    }

    // 优先级2: 单个换行符
    const lineBreak = text.lastIndexOf('\n', end);
    if (lineBreak > searchStart && lineBreak > start) {
      return lineBreak + 1;
    }

    // 优先级3: 句号、问号、感叹号
    const sentenceEndings = ['. ', '。', '? ', '？', '! ', '！'];
    let bestBreak = -1;

    for (const ending of sentenceEndings) {
      const pos = text.lastIndexOf(ending, end);
      if (pos > searchStart && pos > bestBreak && pos > start) {
        bestBreak = pos + ending.length;
      }
    }

    if (bestBreak > start) {
      return bestBreak;
    }

    // 优先级4: 逗号、分号
    const punctuationMarks = [', ', '，', '; ', '；'];
    for (const mark of punctuationMarks) {
      const pos = text.lastIndexOf(mark, end);
      if (pos > searchStart && pos > bestBreak && pos > start) {
        bestBreak = pos + mark.length;
      }
    }

    if (bestBreak > start) {
      return bestBreak;
    }

    // 优先级5: 空格
    const spacePos = text.lastIndexOf(' ', end);
    if (spacePos > searchStart && spacePos > start) {
      return spacePos + 1;
    }

    // 如果都找不到，就在原位置分割
    return end;
  }

  /**
   * 按段落分块（保持段落完整性）
   */
  static chunkByParagraphs(
    text: string,
    maxChunkSize: number = 1000,
  ): string[] {
    const paragraphs = text.split(/\n\n+/).filter((p) => p.trim().length > 0);
    const chunks: string[] = [];
    let currentChunk = '';

    for (const paragraph of paragraphs) {
      const trimmedParagraph = paragraph.trim();

      // 如果单个段落就超过最大大小，需要进一步分块
      if (trimmedParagraph.length > maxChunkSize) {
        if (currentChunk) {
          chunks.push(currentChunk.trim());
          currentChunk = '';
        }
        // 对大段落进行分块
        const subChunks = this.chunk(trimmedParagraph, maxChunkSize, 100);
        chunks.push(...subChunks);
        continue;
      }

      // 如果加上当前段落会超过大小限制，先保存当前块
      if (currentChunk.length + trimmedParagraph.length + 2 > maxChunkSize) {
        if (currentChunk) {
          chunks.push(currentChunk.trim());
        }
        currentChunk = trimmedParagraph;
      } else {
        // 否则追加到当前块
        currentChunk += (currentChunk ? '\n\n' : '') + trimmedParagraph;
      }
    }

    // 保存最后一块
    if (currentChunk) {
      chunks.push(currentChunk.trim());
    }

    return chunks;
  }

  /**
   * 估算文本的 token 数量（粗略估算）
   * 英文: ~4 字符 = 1 token
   * 中文: ~1.5 字符 = 1 token
   */
  static estimateTokens(text: string): number {
    const chineseChars = (text.match(/[一-龥]/g) || []).length;
    const otherChars = text.length - chineseChars;

    return Math.ceil(chineseChars / 1.5 + otherChars / 4);
  }
}
