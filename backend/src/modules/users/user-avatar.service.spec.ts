import { ConfigService } from '@nestjs/config';
import { mkdtemp, rm } from 'fs/promises';
import { tmpdir } from 'os';
import { join } from 'path';
import { BadRequestException, NotFoundException, PayloadTooLargeException } from '@nestjs/common';
import { LocalStorageDriver } from '../upload/storage/local-storage.driver';
import { StorageService } from '../upload/storage/storage.service';
import { PrismaService } from '../../prisma/prisma.service';
import { EnterpriseContextService } from '../enterprise/enterprise-context.service';
import { UserService, MAX_USER_AVATAR_SIZE } from './user.service';

/** 最小合法 PNG 头（8 字节魔数 + 若干填充），够过 validateUploadedFile 的魔数校验。 */
function image(originalname = 'avatar.png', bytes?: Buffer): Express.Multer.File {
  const buffer = bytes ?? Buffer.from('89504e470d0a1a0a00000000', 'hex');
  return {
    originalname,
    buffer,
    size: buffer.length,
    mimetype: 'image/png',
  } as Express.Multer.File;
}

describe('UserService 头像上传', () => {
  let service: UserService;
  let prisma: { user: { update: jest.Mock; findUnique: jest.Mock } };
  let context: { resolve: jest.Mock; resolveOrNull: jest.Mock };
  let storage: { put: jest.Mock; get: jest.Mock; delete: jest.Mock };

  beforeEach(() => {
    prisma = {
      user: {
        update: jest.fn().mockResolvedValue({}),
        findUnique: jest.fn().mockResolvedValue({ id: 'u1' }),
      },
    };
    context = {
      resolve: jest.fn().mockResolvedValue({ enterpriseId: 'ent-1' }),
      resolveOrNull: jest.fn().mockResolvedValue({ enterpriseId: 'ent-1' }),
    };
    storage = {
      // 故意返回带签名的临时地址：服务绝不能把它写进 DB
      put: jest.fn().mockResolvedValue({ url: '/uploads/temp?exp=1&sig=x', key: 'k', size: 16 }),
      get: jest.fn().mockResolvedValue(image().buffer),
      delete: jest.fn().mockResolvedValue(undefined),
    };
    service = new UserService(
      prisma as unknown as PrismaService,
      context as unknown as EnterpriseContextService,
      storage as unknown as StorageService,
    );
  });

  it('落库的是稳定公开路径，而不是会过期的签名地址', async () => {
    const result = await service.uploadAvatar('u1', image());

    expect(result.avatar).toMatch(/^\/api\/users\/avatars\/[a-f0-9-]+\.png$/);
    expect(result.avatar).not.toContain('?');
    expect(prisma.user.update).toHaveBeenCalledWith({
      where: { id: 'u1' },
      data: { avatar: result.avatar },
    });
    expect(storage.put).toHaveBeenCalledWith(
      expect.objectContaining({
        mime: 'image/png',
        key: `user-avatars/${result.avatar.split('/').pop()}`,
      }),
    );
  });

  it('文件名用随机 UUID，不复用用户提供的名字（避免同名覆盖与路径注入）', async () => {
    const a = await service.uploadAvatar('u1', image('../../etc/passwd.png'));
    const b = await service.uploadAvatar('u1', image('../../etc/passwd.png'));
    expect(a.avatar).not.toEqual(b.avatar);
  });

  it('拒绝缺失、超大与伪造的头像', async () => {
    await expect(service.uploadAvatar('u1', undefined)).rejects.toBeInstanceOf(BadRequestException);
    await expect(
      service.uploadAvatar('u1', image('avatar.png', Buffer.alloc(0))),
    ).rejects.toBeInstanceOf(BadRequestException);
    // 扩展名不在白名单
    await expect(
      service.uploadAvatar('u1', image('avatar.svg', Buffer.from('<svg/>'))),
    ).rejects.toBeInstanceOf(BadRequestException);
    // 扩展名是 .png 但字节不是图片：魔数校验必须拦住
    await expect(
      service.uploadAvatar('u1', image('avatar.png', Buffer.from('<script>alert(1)</script>'))),
    ).rejects.toBeInstanceOf(BadRequestException);

    expect(storage.put).not.toHaveBeenCalled();
    expect(prisma.user.update).not.toHaveBeenCalled();
  });

  it('按真实字节判大小，声明的 size 造假也不放过', async () => {
    const file = image('avatar.png', Buffer.alloc(MAX_USER_AVATAR_SIZE + 1));
    file.size = 1; // 伪造一个很小的 size
    await expect(service.uploadAvatar('u1', file)).rejects.toBeInstanceOf(PayloadTooLargeException);
    expect(storage.put).not.toHaveBeenCalled();
  });

  it('接受 JPEG / WebP，且 MIME 由服务端推导', async () => {
    await service.uploadAvatar('u1', image('a.jpg', Buffer.from('ffd8ff0000', 'hex')));
    expect(storage.put).toHaveBeenCalledWith(expect.objectContaining({ mime: 'image/jpeg' }));

    await service.uploadAvatar(
      'u1',
      image('a.webp', Buffer.from('524946460000000057454250', 'hex')),
    );
    expect(storage.put).toHaveBeenCalledWith(expect.objectContaining({ mime: 'image/webp' }));
  });

  it('DB 写入失败时把已落盘的文件删掉，不留孤儿对象', async () => {
    prisma.user.update.mockRejectedValue(new Error('db unavailable'));
    await expect(service.uploadAvatar('u1', image())).rejects.toThrow('db unavailable');
    expect(storage.delete).toHaveBeenCalledWith(storage.put.mock.calls[0][0].key);
  });

  it('只从 user-avatars 前缀读取，且按扩展名回正确的 Content-Type', async () => {
    const { avatar } = await service.uploadAvatar('u1', image());
    const filename = avatar.split('/').pop()!;

    expect(await service.readAvatar(filename)).toEqual({
      buffer: image().buffer,
      mime: 'image/png',
    });
    expect(storage.get).toHaveBeenCalledWith(`user-avatars/${filename}`);
  });

  it.each([
    '../../../personal/u2/secret.png',
    'file.svg',
    'not-a-uuid.png',
    '../enterprise-logos/leak.png',
  ])('挡住非本服务命名的读取：%s', async (filename) => {
    await expect(service.readAvatar(filename)).rejects.toBeInstanceOf(NotFoundException);
    expect(storage.get).not.toHaveBeenCalled();
  });

  it('端到端：真实本地驱动写入后再读出，字节一致', async () => {
    const root = await mkdtemp(join(tmpdir(), 'sep-user-avatar-'));
    const values: Record<string, string> = {
      UPLOAD_LOCAL_DIR: root,
      UPLOAD_URL_SECRET: 'avatar-test-secret',
    };
    const config = { get: (key: string) => values[key] } as ConfigService;
    let published: string | undefined;
    prisma.user.update.mockImplementation(async ({ data }) => {
      published = data.avatar;
      return data;
    });
    const make = () =>
      new UserService(
        prisma as unknown as PrismaService,
        context as unknown as EnterpriseContextService,
        new StorageService(config, new LocalStorageDriver(config)),
      );

    try {
      const { avatar } = await make().uploadAvatar('u1', image());
      expect(avatar).toBe(published);
      const read = await make().readAvatar(avatar.split('/').pop()!);
      expect(read.buffer).toEqual(image().buffer);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});
