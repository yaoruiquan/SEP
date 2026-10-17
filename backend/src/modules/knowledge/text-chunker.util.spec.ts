import { BadRequestException, ServiceUnavailableException } from '@nestjs/common';
import { execFile } from 'node:child_process';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { promisify } from 'node:util';
import { TextChunker, TokenBudgetTokenizer } from './text-chunker.util';

const execute = promisify(execFile);
const codePointTokenizer: TokenBudgetTokenizer = {
  id: 'test-code-points',
  encode: (text) => Uint32Array.from(Array.from(text).map((character) => character.codePointAt(0))),
};

describe('TextChunker token budgets', () => {
  it('fails closed without an initialized real tokenizer', () => {
    TextChunker.resetTokenizer();
    expect(() => TextChunker.countTokens('hello')).toThrow(ServiceUnavailableException);
    try {
      TextChunker.chunkByTokens('hello');
      throw new Error('Expected tokenizer failure');
    } catch (error) {
      expect(error).toBeInstanceOf(ServiceUnavailableException);
      expect(error).toMatchObject({ code: 'TOKENIZER_UNAVAILABLE', retryable: false });
      expect(error.getResponse()).toMatchObject({ code: 'TOKENIZER_UNAVAILABLE', retryable: false });
    }
  });

  it('normalizes local initialization failures to a non-retryable structured error', async () => {
    await expect(TextChunker.initializeTokenizer('/nonexistent/local/tokenizer', 'test-revision'))
      .rejects.toMatchObject({ response: expect.objectContaining({ code: 'TOKENIZER_UNAVAILABLE', retryable: false }) });
    expect(() => TextChunker.countTokens('hello')).toThrow(ServiceUnavailableException);
  });

  it('preserves source text, newlines, offsets and Unicode code points', () => {
    const text = '你好\n\nHello 2026 👩🏽‍💻\n世界！';
    const chunks = TextChunker.chunkByTokenBudget(text, codePointTokenizer, { maxTokens: 4 });
    expect(chunks.map((chunk) => chunk.text).join('')).toBe(text);
    for (const chunk of chunks) {
      expect(chunk.text).toBe(text.slice(chunk.startOffset, chunk.endOffset));
      expect(chunk.tokenCount).toBe(Array.from(chunk.text).length);
      expect(chunk.tokenCount).toBeLessThanOrEqual(4);
      expect(chunk.text).not.toMatch(/^[\uDC00-\uDFFF]|[\uD800-\uDBFF]$/);
    }
  });

  it('applies reserved tokens and overlap without losing forward progress', () => {
    const text = 'abcdefghijklmnopqrstuvwxyz';
    const chunks = TextChunker.chunkByTokenBudget(text, codePointTokenizer,
      { maxTokens: 8, reserveTokens: 2, overlapTokens: 3 });
    expect(chunks[0].text).toBe('abcdef');
    expect(chunks[1].text).toBe('defghi');
    expect(chunks[chunks.length - 1].endOffset).toBe(text.length);
    chunks.forEach((chunk, index) => {
      expect(chunk.tokenCount + 2).toBeLessThanOrEqual(8);
      if (index) expect(chunk.endOffset).toBeGreaterThan(chunks[index - 1].endOffset);
    });
  });

  it('does not emit a redundant trailing overlap chunk', () => {
    const chunks = TextChunker.chunkByTokenBudget('abcdefgh', codePointTokenizer, { maxTokens: 5, overlapTokens: 2 });
    expect(chunks.map((chunk) => chunk.text)).toEqual(['abcde', 'defgh']);
  });

  it.each([{ maxTokens: 0 }, { maxTokens: 3.5 }, { maxTokens: 4, overlapTokens: 4 },
    { maxTokens: 4, reserveTokens: 4 }, { maxTokens: 4, overlapTokens: -1 },
    { maxTokens: NaN }])('rejects invalid budgets: %j', (options) => {
    expect(() => TextChunker.chunkByTokenBudget('abc', codePointTokenizer, options)).toThrow(BadRequestException);
  });

  it('rejects invalid tokenizer counts and a code point that cannot fit', () => {
    expect(() => TextChunker.countTokens('a', { id: 'broken', encode: () => ({ length: NaN }) })).toThrow('invalid token count');
    expect(() => TextChunker.countTokens('a', { id: 'broken', encode: () => [] })).toThrow('invalid token count');
    const oversized = { id: 'oversized-test', encode: () => new Uint32Array(100) };
    expect(() => TextChunker.chunkByTokenBudget('😀', oversized, { maxTokens: 1 })).toThrow('cannot fit');
  });

  it('handles empty input without producing chunks', () => {
    expect(TextChunker.chunkByTokens('')).toEqual([]);
    expect(TextChunker.chunkByTokenBudget(' \n\t', codePointTokenizer)).toEqual([]);
  });

  it('requires local absolute tokenizer directories and persistent identifiers', async () => {
    await expect(TextChunker.loadTokenizer('https://models.example/tokenizer', 'model')).rejects.toThrow('absolute local');
    await expect(TextChunker.loadTokenizer('/local/model', '')).rejects.toThrow('identifier');
  });

  it('uses a real offline Transformers WordPiece tokenizer through the processor API', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'sep-tokenizer-'));
    try {
      const vocab = { '[UNK]': 0, '[CLS]': 1, '[SEP]': 2, hello: 3, world: 4,
        '你': 5, '好': 6, '世': 7, '界': 8, '2026': 9, '!': 10 };
      await writeFile(join(directory, 'tokenizer.json'), JSON.stringify({
        version: '1.0', added_tokens: [],
        normalizer: { type: 'BertNormalizer', clean_text: true, handle_chinese_chars: true, strip_accents: null, lowercase: true },
        pre_tokenizer: { type: 'BertPreTokenizer' },
        model: { type: 'WordPiece', vocab, unk_token: '[UNK]', continuing_subword_prefix: '##', max_input_chars_per_word: 100 },
        post_processor: { type: 'TemplateProcessing', single: [{ SpecialToken: { id: '[CLS]', type_id: 0 } },
          { Sequence: { id: 'A', type_id: 0 } }, { SpecialToken: { id: '[SEP]', type_id: 0 } }],
          special_tokens: { '[CLS]': { id: '[CLS]', ids: [1], tokens: ['[CLS]'] }, '[SEP]': { id: '[SEP]', ids: [2], tokens: ['[SEP]'] } } },
        decoder: { type: 'WordPiece', prefix: '##', cleanup: true },
      }));
      await writeFile(join(directory, 'tokenizer_config.json'), JSON.stringify({
        tokenizer_class: 'BertTokenizer', unk_token: '[UNK]', cls_token: '[CLS]', sep_token: '[SEP]', model_max_length: 100_000,
      }));
      // Native ESM runs outside Jest's CommonJS VM; no model or network is involved.
      const script = `
        const assert = require('node:assert/strict');
        const { TextChunker } = require(process.argv[1]);
        const { EmbeddingService } = require(require('node:path').join(require('node:path').dirname(process.argv[1]), 'embedding.service.ts'));
        (async () => {
          global.fetch = async () => { throw new Error('Network access forbidden'); };
          const values = { EMBEDDING_MODEL: 'fixture-bge-m3-revision-abc', EMBEDDING_DIMENSION: '1024',
            EMBEDDING_TOKENIZER: 'fixture-wordpiece@revision-abc', EMBEDDING_TOKENIZER_PATH: process.argv[2] };
          const service = new EmbeddingService({ get: key => values[key] });
          await service.onModuleInit();
          assert.deepEqual(service.getProfile(), { model: 'fixture-bge-m3-revision-abc', dimension: 1024,
            tokenizer: 'fixture-wordpiece@revision-abc', distance: 'cosine' });
          assert.equal(TextChunker.countTokens('hello world'), 4);
          assert.equal(TextChunker.countTokens('你好世界'), 6);
          const text = '你好世界 hello world 2026!\\n'.repeat(100);
          const chunks = TextChunker.chunkByTokens(text, 8);
          assert.equal(chunks.map(c => c.content).join(''), text);
          for (const chunk of chunks) {
            assert.equal(chunk.tokenCount, TextChunker.countTokens(chunk.content));
            assert.ok(chunk.tokenCount <= 8);
            assert.deepEqual(Object.keys(chunk).sort(), ['content', 'tokenCount']);
          }
          const defaults = TextChunker.chunkByTokens(text);
          assert.ok(defaults.every(c => c.tokenCount <= 800));
          assert.ok(defaults.some(c => c.tokenCount > 8));
          console.log(JSON.stringify({ chunks: chunks.length, defaultChunks: defaults.length, offline: true }));
        })().catch(error => { console.error(error); process.exitCode = 1; });
      `;
      const { stdout } = await execute(process.execPath, ['--require', 'tsx/cjs', '-e', script,
        resolve(__dirname, 'text-chunker.util.ts'), directory], { cwd: resolve(__dirname, '../../..'), timeout: 20_000 });
      expect(JSON.parse(stdout)).toMatchObject({ chunks: expect.any(Number), offline: true });
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  }, 25_000);
});
