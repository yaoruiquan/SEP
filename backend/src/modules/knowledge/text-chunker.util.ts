/**
 * 文本分块工具
 * 将长文本分割成适合向量化的小块
 */
export class TextChunker {
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
