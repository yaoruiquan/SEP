import { HttpException } from '@nestjs/common';
import { inflateSync } from 'node:zlib';

/** Validate bounded PNG chunks, CRCs and decoded scanlines before retaining upstream bytes. */
export function inspectMediaPng(bytes: Buffer, maxBytes = 25 * 1024 * 1024) {
  const invalid = (): never => { throw new HttpException({ error: { code: 'OUTPUT_FAILED', message: '图片 PNG 数据无效' } }, 502); };
  if (!Buffer.isBuffer(bytes) || bytes.length < 45 || bytes.length > maxBytes ||
    !bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))) invalid();
  let offset = 8; let width = 0; let height = 0; let channels = 0; let depth = 0; let ended = false;
  const compressed: Buffer[] = [];
  while (offset + 12 <= bytes.length) {
    const size = bytes.readUInt32BE(offset);
    if (size > maxBytes || offset + size + 12 > bytes.length) invalid();
    const type = bytes.toString('ascii', offset + 4, offset + 8);
    const data = bytes.subarray(offset + 8, offset + 8 + size);
    let crc = 0xffffffff;
    for (const byte of bytes.subarray(offset + 4, offset + 8 + size)) {
      crc ^= byte;
      for (let bit = 0; bit < 8; bit++) crc = (crc >>> 1) ^ ((crc & 1) ? 0xedb88320 : 0);
    }
    if (((crc ^ 0xffffffff) >>> 0) !== bytes.readUInt32BE(offset + 8 + size)) invalid();
    if (!width && type !== 'IHDR') invalid();
    if (type === 'IHDR') {
      if (width || size !== 13) invalid();
      width = data.readUInt32BE(0); height = data.readUInt32BE(4); depth = data[8];
      channels = ({ 0: 1, 2: 3, 3: 1, 4: 2, 6: 4 } as Record<number, number>)[data[9]];
      if (!width || !height || width > 4096 || height > 4096 || !channels ||
        ![1, 2, 4, 8, 16].includes(depth) || data[10] !== 0 || data[11] !== 0 || data[12] !== 0 ||
        ((data[9] === 2 || data[9] === 4 || data[9] === 6) && depth < 8) || (data[9] === 3 && depth === 16)) invalid();
    } else if (type === 'IDAT') compressed.push(data);
    else if (type === 'IEND') { if (size || offset + 12 !== bytes.length) invalid(); ended = true; break; }
    offset += size + 12;
  }
  if (!ended || !compressed.length) invalid();
  const stride = Math.ceil(width * channels * depth / 8) + 1;
  const expected = stride * height;
  if (expected > 80 * 1024 * 1024) invalid();
  try {
    const decoded = inflateSync(Buffer.concat(compressed), { maxOutputLength: expected });
    if (decoded.length !== expected) invalid();
    for (let row = 0; row < height; row++) if (decoded[row * stride] > 4) invalid();
  } catch { invalid(); }
  return { width, height };
}
