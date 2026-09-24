import { BadRequestException } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import AdmZip from "adm-zip";
import { mkdtemp, rm } from "fs/promises";
import { tmpdir } from "os";
import { join } from "path";
import { RpaPackageService } from "./rpa-package.service";

function zipWith(entries: Record<string, string>) {
  const zip = new AdmZip();
  for (const [name, content] of Object.entries(entries))
    zip.addFile(name, Buffer.from(content));
  return zip.toBuffer();
}

describe("RpaPackageService", () => {
  let root: string;
  let service: RpaPackageService;

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), "sep-rpa-"));
    service = new RpaPackageService({
      get: () => root,
    } as unknown as ConfigService);
  });

  afterEach(async () => rm(root, { recursive: true, force: true }));

  it("stores a valid zip by content hash and returns metadata", async () => {
    const stored = await service.store({
      originalname: "flow.zip",
      buffer: zipWith({ "flow.json": "{}" }),
    } as Express.Multer.File);
    expect(stored.key).toMatch(/^rpa\/[0-9a-f]{64}\.zip$/);
    expect(stored.fileCount).toBe(1);
    expect((await service.read(stored.sha256)).sha256).toBe(stored.sha256);
  });

  it("rejects path traversal and credential files", async () => {
    await expect(
      service.store({
        originalname: "flow.zip",
        buffer: zipWith({ "C:/escape.txt": "x" }),
      } as Express.Multer.File),
    ).rejects.toBeInstanceOf(BadRequestException);
    const normalizedTraversal = zipWith({ "safe.txt": "x" });
    // Keep the ZIP valid but replace both local-header and central-directory
    // names with an equal-length traversal name. adm-zip normalizes this while
    // parsing, so the service must inspect rawEntryName too.
    const traversalZip = Buffer.from(normalizedTraversal);
    const safeName = Buffer.from("safe.txt");
    const traversalName = Buffer.from("../a.txt");
    for (
      let offset = 0;
      offset <= traversalZip.length - safeName.length;
      offset += 1
    ) {
      if (
        traversalZip.subarray(offset, offset + safeName.length).equals(safeName)
      ) {
        traversalName.copy(traversalZip, offset);
      }
    }
    await expect(
      service.store({
        originalname: "flow.zip",
        buffer: traversalZip,
      } as Express.Multer.File),
    ).rejects.toBeInstanceOf(BadRequestException);
    await expect(
      service.store({
        originalname: "flow.zip",
        buffer: zipWith({ ".env": "TOKEN=secret-value" }),
      } as Express.Multer.File),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it("rejects non-zip uploads", async () => {
    await expect(
      service.store({
        originalname: "flow.zip",
        buffer: Buffer.from("not zip"),
      } as Express.Multer.File),
    ).rejects.toBeInstanceOf(BadRequestException);
    await expect(
      service.store({
        originalname: "flow.txt",
        buffer: Buffer.from("PK\x03\x04"),
      } as Express.Multer.File),
    ).rejects.toBeInstanceOf(BadRequestException);
  });
});
