import { deflateSync } from 'node:zlib';
import { HttpException } from '@nestjs/common';
import { inspectMediaPng } from './media-png';

const SIGNATURE = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);

function chunk(type: string, data: Buffer): Buffer {
  const typeBytes = Buffer.from(type, 'ascii');
  const crcInput = Buffer.concat([typeBytes, data]);
  let crc = 0xffffffff;
  for (const byte of crcInput) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit++) crc = (crc >>> 1) ^ ((crc & 1) ? 0xedb88320 : 0);
  }
  const header = Buffer.alloc(4);
  header.writeUInt32BE(data.length);
  const checksum = Buffer.alloc(4);
  checksum.writeUInt32BE((crc ^ 0xffffffff) >>> 0);
  return Buffer.concat([header, typeBytes, data, checksum]);
}

function png(width = 1, height = 1, rows?: Buffer, depth = 8, colorType = 6): Buffer {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = depth;
  ihdr[9] = colorType;
  const channels = ({ 0: 1, 2: 3, 3: 1, 4: 2, 6: 4 } as Record<number, number>)[colorType];
  const scanlines = rows ?? Buffer.alloc(height * (Math.ceil(width * channels * depth / 8) + 1));
  return Buffer.concat([
    SIGNATURE,
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(scanlines)),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

async function expectInvalid(bytes: Buffer, maxBytes?: number) {
  const error = await Promise.resolve().then(() => inspectMediaPng(bytes, maxBytes)).then(
    () => { throw new Error('Expected invalid PNG'); },
    (reason: unknown) => reason,
  );
  expect(error).toBeInstanceOf(HttpException);
  expect((error as HttpException).getStatus()).toBe(502);
  expect((error as HttpException).getResponse()).toMatchObject({ error: { code: 'OUTPUT_FAILED' } });
}

describe('inspectMediaPng', () => {
  it('returns dimensions for a valid PNG', () => {
    expect(inspectMediaPng(png(3, 2))).toEqual({ width: 3, height: 2 });
  });

  it.each([
    ['truncated signature', Buffer.from([137, 80, 78, 71])],
    ['wrong signature', Buffer.from('not a png')],
    ['truncated chunk', Buffer.concat([SIGNATURE, Buffer.from([0, 0, 0, 13, 73, 72, 68, 82])])],
    ['bad chunk CRC', (() => { const value = png(); value[29] ^= 0xff; return value; })()],
    ['missing IEND', png().subarray(0, -12)],
    ['trailing bytes', Buffer.concat([png(), Buffer.from([0])])],
    ['invalid zlib stream', (() => {
      const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(1, 0); ihdr.writeUInt32BE(1, 4); ihdr[8] = 8; ihdr[9] = 6;
      return Buffer.concat([SIGNATURE, chunk('IHDR', ihdr), chunk('IDAT', Buffer.from('broken')), chunk('IEND', Buffer.alloc(0))]);
    })()],
    ['incorrect decoded row length', png(1, 1, Buffer.alloc(4))],
    ['invalid scanline filter', png(1, 1, Buffer.from([5, 0, 0, 0, 0]))],
    ['zero width', (() => { const value = png(); value.writeUInt32BE(0, 16); return value; })()],
    ['oversized dimensions', (() => { const value = png(); value.writeUInt32BE(4097, 16); return value; })()],
  ])('rejects %s', (_label, bytes) => expectInvalid(bytes as Buffer));

  it('rejects files above the byte budget and accepts the exact budget', async () => {
    const valid = png();
    expect(inspectMediaPng(valid, valid.length)).toEqual({ width: 1, height: 1 });
    await expectInvalid(valid, valid.length - 1);
    await expectInvalid(Buffer.alloc(0), 100);
  });

  it('rejects decompression bombs beyond the bounded decoded size', async () => {
    await expectInvalid(png(4096, 4096, undefined, 16));
  });
});
