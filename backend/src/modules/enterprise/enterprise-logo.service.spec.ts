import { ConfigService } from '@nestjs/config';
import { mkdtemp, rm } from 'fs/promises';
import { tmpdir } from 'os';
import { join } from 'path';
import { LocalStorageDriver } from '../upload/storage/local-storage.driver';
import { BadRequestException, ForbiddenException, NotFoundException, PayloadTooLargeException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { StorageService } from '../upload/storage/storage.service';
import { EnterpriseContextService } from './enterprise-context.service';
import { EnterpriseLogoService, MAX_ENTERPRISE_LOGO_SIZE } from './enterprise-logo.service';

function image(originalname = 'logo.png', bytes?: Buffer): Express.Multer.File {
  const buffer = bytes ?? Buffer.from('89504e470d0a1a0a00000000', 'hex');
  return { originalname, buffer, size: buffer.length, mimetype: 'image/png' } as Express.Multer.File;
}

describe('EnterpriseLogoService', () => {
  let service: EnterpriseLogoService;
  let prisma: { enterprise: { update: jest.Mock; findFirst: jest.Mock } };
  let context: { resolve: jest.Mock; assertEnterpriseAdmin: jest.Mock };
  let storage: { put: jest.Mock; get: jest.Mock; delete: jest.Mock };
  beforeEach(() => {
    prisma = { enterprise: { update: jest.fn().mockResolvedValue({}), findFirst: jest.fn().mockResolvedValue({ id: 'ent-own' }) } };
    context = {
      resolve: jest.fn().mockResolvedValue({ enterpriseId: 'ent-own', role: 'ENTERPRISE_ADMIN' }),
      assertEnterpriseAdmin: jest.fn((ctx) => { if (ctx.role !== 'ENTERPRISE_ADMIN') throw new ForbiddenException(); }),
    };
    storage = { put: jest.fn().mockResolvedValue({ url: '/uploads/temp?exp=123&sig=secret' }), get: jest.fn().mockResolvedValue(image().buffer), delete: jest.fn().mockResolvedValue(undefined) };
    service = new EnterpriseLogoService(prisma as unknown as PrismaService, context as unknown as EnterpriseContextService, storage as unknown as StorageService);
  });

  it('persists actual local storage bytes and reads them after service recreation', async () => {
    const root = await mkdtemp(join(tmpdir(), 'sep-enterprise-logo-'));
    const values: Record<string, string> = { UPLOAD_LOCAL_DIR: root, UPLOAD_URL_SECRET: 'logo-test-secret' };
    const config = { get: (key: string) => values[key] } as ConfigService;
    let publishedLogo: string | undefined;
    prisma.enterprise.update.mockImplementation(async ({ data }) => { publishedLogo = data.logo; return data; });
    prisma.enterprise.findFirst.mockImplementation(async ({ where }) => where.logo === publishedLogo ? { id: 'ent-own' } : null);
    const createService = () => new EnterpriseLogoService(
      prisma as unknown as PrismaService, context as unknown as EnterpriseContextService,
      new StorageService(config, new LocalStorageDriver(config)),
    );
    try {
      const uploaded = await createService().upload('admin', image());
      const read = await createService().read(uploaded.logo.split('/').pop()!);
      expect(read.buffer).toEqual(image().buffer);
      expect(read.mime).toBe('image/png');
      expect(uploaded.logo).not.toMatch(/[?&](exp|sig)=/);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it('persists a stable public URL on the server-resolved enterprise, never the signed storage URL', async () => {
    const result = await service.upload('user-admin', image());
    expect(context.resolve).toHaveBeenCalledWith('user-admin');
    expect(result.logo).toMatch(/^\/api\/enterprise\/logos\/[a-f0-9-]+\.png$/);
    expect(result.logo).not.toContain('?');
    expect(prisma.enterprise.update).toHaveBeenCalledWith({ where: { id: 'ent-own' }, data: result });
    expect(storage.put).toHaveBeenCalledWith(expect.objectContaining({ mime: 'image/png', key: `enterprise-logos/${result.logo.split('/').pop()}` }));
  });

  it.each(['MEMBER', 'DEPT_MANAGER'])('rejects %s before storing any bytes', async (role) => {
    context.resolve.mockResolvedValue({ enterpriseId: 'ent-own', role });
    await expect(service.upload('member', image())).rejects.toBeInstanceOf(ForbiddenException);
    expect(storage.put).not.toHaveBeenCalled();
    expect(prisma.enterprise.update).not.toHaveBeenCalled();
  });

  it('rejects users without enterprise membership', async () => {
    context.resolve.mockRejectedValue(new ForbiddenException());
    await expect(service.upload('outsider', image())).rejects.toBeInstanceOf(ForbiddenException);
    expect(storage.put).not.toHaveBeenCalled();
  });

  it.each([undefined, image('logo.png', Buffer.alloc(0)), image('logo.svg', Buffer.from('<svg/>')), image('logo.png', Buffer.from('<script>alert(1)</script>')), image('logo.webp', Buffer.from('RIFFbadnotwebp'))])('rejects absent, unsupported and forged images', async (file) => {
    await expect(service.upload('admin', file)).rejects.toBeInstanceOf(BadRequestException);
    expect(storage.put).not.toHaveBeenCalled();
  });

  it('checks actual bytes even if declared size is forged', async () => {
    const file = image('logo.png', Buffer.alloc(MAX_ENTERPRISE_LOGO_SIZE + 1));
    file.size = 1;
    await expect(service.upload('admin', file)).rejects.toBeInstanceOf(PayloadTooLargeException);
    expect(storage.put).not.toHaveBeenCalled();
  });

  it.each([['logo.jpg', 'ffd8ff0000', 'image/jpeg'], ['logo.webp', '524946460000000057454250', 'image/webp']])('accepts valid %s signatures and derives MIME server-side', async (filename, hex, mime) => {
    await service.upload('admin', image(filename, Buffer.from(hex, 'hex')));
    expect(storage.put).toHaveBeenCalledWith(expect.objectContaining({ mime }));
  });

  it('removes a newly stored file if database persistence fails', async () => {
    prisma.enterprise.update.mockRejectedValue(new Error('db unavailable'));
    await expect(service.upload('admin', image())).rejects.toThrow('db unavailable');
    expect(storage.delete).toHaveBeenCalledWith(storage.put.mock.calls[0][0].key);
  });

  it('reads only the active published logo without requesting an expiring URL', async () => {
    const { logo } = await service.upload('admin', image());
    const filename = logo.split('/').pop()!;
    expect(await service.read(filename)).toEqual({ buffer: image().buffer, mime: 'image/png' });
    expect(prisma.enterprise.findFirst).toHaveBeenCalledWith({ where: { logo }, select: { id: true } });
    expect(storage.get).toHaveBeenCalledWith(`enterprise-logos/${filename}`);
  });

  it('does not publish unbound or replaced files', async () => {
    prisma.enterprise.findFirst.mockResolvedValue(null);
    await expect(service.read('12345678-1234-4234-8234-123456789012.png')).rejects.toBeInstanceOf(NotFoundException);
    expect(storage.get).not.toHaveBeenCalled();
  });

  it.each(['../../personal/user/secret.png', 'file.svg', 'not-a-uuid.png'])('blocks arbitrary storage reads: %s', async (filename) => {
    await expect(service.read(filename)).rejects.toBeInstanceOf(NotFoundException);
    expect(storage.get).not.toHaveBeenCalled();
    expect(prisma.enterprise.findFirst).not.toHaveBeenCalled();
  });
});
