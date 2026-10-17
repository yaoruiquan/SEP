import {
  BadRequestException, PayloadTooLargeException, RequestTimeoutException,
  UnprocessableEntityException, UnsupportedMediaTypeException,
} from '@nestjs/common';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createServer, Server } from 'node:http';
import AdmZip from 'adm-zip';
import { DocumentParserService } from './document-parser.service';

const DOCX = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';

function pdfFixture(): Buffer {
  const stream = (text: string) => `<< /Length ${Buffer.byteLength(text)} >>\nstream\n${text}\nendstream`;
  const objects = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R 5 0 R] /Count 2 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 7 0 R >> >> /Contents 4 0 R >>',
    stream('BT /F1 12 Tf 72 720 Td (Revenue 2026) Tj 0 -20 Td (12345) Tj ET'),
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 7 0 R >> >> /Contents 6 0 R >>',
    stream('BT /F1 12 Tf 72 720 Td (Second page) Tj ET'),
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
    '<< /Title (Parser fixture) /Author (Test suite) >>',
  ];
  let body = '%PDF-1.4\n';
  const offsets = [0];
  objects.forEach((object, index) => {
    offsets.push(Buffer.byteLength(body));
    body += `${index + 1} 0 obj\n${object}\nendobj\n`;
  });
  const xref = Buffer.byteLength(body);
  body += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  body += offsets.slice(1).map((offset) => `${String(offset).padStart(10, '0')} 00000 n \n`).join('');
  body += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R /Info 8 0 R >>\nstartxref\n${xref}\n%%EOF`;
  return Buffer.from(body);
}

function docxFixture(body = '<w:p><w:r><w:t>Revenue 2026</w:t></w:r></w:p>', relationships?: string): Buffer {
  const zip = new AdmZip();
  zip.addFile('[Content_Types].xml', Buffer.from(
    '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>',
  ));
  zip.addFile('word/document.xml', Buffer.from(
    `<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><w:body>${body}</w:body></w:document>`,
  ));
  if (relationships) zip.addFile('word/_rels/document.xml.rels', Buffer.from(relationships));
  return zip.toBuffer();
}

describe('DocumentParserService (real libraries and isolated workers)', () => {
  const service = new DocumentParserService();
  let directory: string;
  beforeEach(async () => { directory = await mkdtemp(join(tmpdir(), 'sep-parser-')); });
  afterEach(async () => { await rm(directory, { recursive: true, force: true }); });
  const fixture = async (data: string | Buffer) => {
    const path = join(directory, 'document');
    await writeFile(path, data);
    return path;
  };

  it('uses pdf-parse 2.4.5 and returns real one-based pages without synthetic page markers', async () => {
    const result = await service.parseDocument(await fixture(pdfFixture()), 'application/pdf');
    expect(result.blocks).toEqual([
      { ordinal: 0, text: expect.stringContaining('Revenue 2026'), page: 1 },
      { ordinal: 1, text: expect.stringContaining('Second page'), page: 2 },
    ]);
    expect(result.text).toBe(result.blocks.map((block) => block.text).join('\n\n'));
    expect(result.text).toContain('12345');
    expect(result.text).not.toMatch(/--\s*\d+ of \d+\s*--/);
    expect(result.metadata).toEqual({ pages: 2, title: 'Parser fixture', author: 'Test suite' });
  });

  it.each(['text/plain', 'text/markdown'])('does not invent page numbers for %s', async (mimeType) => {
    const text = '# Revenue\r\n\r\n2026\n12345';
    const result = await service.parseDocument(await fixture(text), mimeType);
    expect(result).toEqual({ text, blocks: [{ ordinal: 0, text, page: null }] });
  });

  it('extracts DOCX text through the real buffer API without invented page numbers', async () => {
    const result = await service.parseDocument(await fixture(docxFixture()), DOCX);
    expect(result.text).toContain('Revenue 2026');
    expect(result.blocks).toEqual([{ ordinal: 0, text: result.text, page: null }]);
    expect(result.metadata?.pages).toBeUndefined();
  });

  it.each(['application/msword', 'image/png', 'image/jpeg', 'image/jpg', 'image/webp'])('rejects %s before opening files', async (mime) => {
    await expect(service.parseDocument('/does-not-exist', mime)).rejects.toBeInstanceOf(UnsupportedMediaTypeException);
  });

  it('preserves standalone numbers while normalizing whitespace', () => {
    expect(service.cleanText('  Revenue\r\n 2026 \r 12345\n\n\n 0 \n -42 \n 3.14 '))
      .toBe('Revenue\n2026\n12345\n\n0\n-42\n3.14');
  });

  it('terminates the parsing worker on timeout', async () => {
    await expect(service.parseDocument(await fixture(pdfFixture()), 'application/pdf', { timeoutMs: 1 }))
      .rejects.toBeInstanceOf(RequestTimeoutException);
    // A timed-out worker does not poison subsequent jobs.
    await expect(service.parseDocument(await fixture('still available'), 'text/plain')).resolves.toHaveProperty('text', 'still available');
  });

  it('limits input size and PDF page count', async () => {
    await expect(service.parseDocument(await fixture('12345'), 'text/plain', { maxFileBytes: 4 }))
      .rejects.toBeInstanceOf(PayloadTooLargeException);
    await expect(service.parseDocument(await fixture(pdfFixture()), 'application/pdf', { maxPages: 1 }))
      .rejects.toBeInstanceOf(PayloadTooLargeException);
  });

  it('limits ZIP entry count and total expanded bytes before Mammoth runs', async () => {
    const path = await fixture(docxFixture(`<w:p><w:r><w:t>${'x'.repeat(30_000)}</w:t></w:r></w:p>`));
    await expect(service.parseDocument(path, DOCX, { maxZipEntries: 1 }))
      .rejects.toBeInstanceOf(PayloadTooLargeException);
    await expect(service.parseDocument(path, DOCX, { maxZipBytes: 1024 }))
      .rejects.toBeInstanceOf(PayloadTooLargeException);
  });

  it('rejects forged ZIP uncompressed sizes using bounded actual inflation', async () => {
    const data = docxFixture(`<w:p><w:r><w:t>${'x'.repeat(30_000)}</w:t></w:r></w:p>`);
    const centralDirectory = data.lastIndexOf(Buffer.from([0x50, 0x4b, 0x01, 0x02]));
    data.writeUInt32LE(1, centralDirectory + 24);
    await expect(service.parseDocument(await fixture(data), DOCX, { maxZipBytes: 1024 }))
      .rejects.toBeInstanceOf(UnprocessableEntityException);
  });

  it('does not fetch external DOCX resources or include local file contents', async () => {
    let hits = 0;
    const server: Server = createServer((_request, response) => { hits++; response.end('external secret'); });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    try {
      const port = (server.address() as { port: number }).port;
      const secret = join(directory, 'secret.txt');
      await writeFile(secret, 'LOCAL_RESOURCE_MUST_NOT_BE_READ');
      const relationships = `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="http://127.0.0.1:${port}/secret" TargetMode="External"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="file://${secret}" TargetMode="External"/></Relationships>`;
      const text = '<w:p><w:r><w:t>Safe text</w:t></w:r></w:p><w:p><w:r><w:pict xmlns:v="urn:schemas-microsoft-com:vml"><v:imagedata r:id="rId1"/><v:imagedata r:id="rId2"/></w:pict></w:r></w:p>';
      const result = await service.parseDocument(await fixture(docxFixture(text, relationships)), DOCX);
      expect(result.text).toContain('Safe text');
      expect(result.text).not.toContain('LOCAL_RESOURCE');
      expect(hits).toBe(0);
    } finally {
      await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
    }
  });

  it('rejects XML entity declarations', async () => {
    const zip = new AdmZip(docxFixture());
    zip.addFile('word/document.xml', Buffer.from('<!DOCTYPE doc [<!ENTITY x SYSTEM "file:///etc/passwd">]><doc>&x;</doc>'));
    await expect(service.parseDocument(await fixture(zip.toBuffer()), DOCX))
      .rejects.toBeInstanceOf(UnprocessableEntityException);
  });

  it('rejects malformed documents and non-regular files without exposing paths', async () => {
    await expect(service.parseDocument(await fixture('not a PDF'), 'application/pdf'))
      .rejects.toBeInstanceOf(UnprocessableEntityException);
    await expect(service.parseDocument(directory, 'text/plain'))
      .rejects.toThrow('Document could not be parsed safely');
  });

  it.each([{ timeoutMs: 0 }, { timeoutMs: 30_001 }, { maxZipBytes: NaN }])('rejects invalid or raised limits: %j', async (limits) => {
    await expect(service.parseDocument('unused', 'text/plain', limits)).rejects.toBeInstanceOf(BadRequestException);
  });
});
