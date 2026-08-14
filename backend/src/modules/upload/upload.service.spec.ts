import { BadRequestException, ForbiddenException } from '@nestjs/common';
import { EnterpriseContextService } from '../enterprise/enterprise-context.service';
import { StorageService } from './storage/storage.service';
import { UploadService } from './upload.service';

const PNG = Buffer.from([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00,
]);

function multerFile(
  originalname: string,
  buffer: Buffer = PNG,
): Express.Multer.File {
  return {
    originalname,
    buffer,
    size: buffer.length,
    mimetype: 'image/png',
    fieldname: 'files',
    encoding: '7bit',
  } as Express.Multer.File;
}

describe('UploadService', () => {
  let storage: jest.Mocked<Pick<StorageService, 'buildKey' | 'put' | 'delete' | 'getSignedUrl'>> & {
    driverName: string;
  };
  let enterpriseContext: { resolveOrNull: jest.Mock };
  let service: UploadService;

  beforeEach(() => {
    storage = {
      buildKey: jest.fn(
        ({ enterpriseId, userId, safeName }) =>
          `${enterpriseId || 'personal'}/${userId}/1700000000000_abcd_${safeName}`,
      ),
      put: jest.fn(async ({ key, buffer }) => ({
        key,
        url: `/uploads/${key}?exp=1&sig=x`,
        size: buffer.length,
      })),
      delete: jest.fn(async () => undefined),
      getSignedUrl: jest.fn(async (key: string) => `/uploads/${key}?exp=2&sig=y`),
      driverName: 'local',
    } as never;

    enterpriseContext = { resolveOrNull: jest.fn(async () => null) };

    service = new UploadService(
      storage as unknown as StorageService,
      enterpriseContext as unknown as EnterpriseContextService,
    );
  });

  describe('uploadFiles', () => {
    it('返回可直接放进消息的附件记录', async () => {
      const [attachment] = await service.uploadFiles(
        [multerFile('photo.png')],
        'u1',
      );

      expect(attachment).toMatchObject({
        type: 'image',
        name: 'photo.png',
        mimeType: 'image/png',
        size: PNG.length,
      });
      expect(attachment.key).toBe('personal/u1/1700000000000_abcd_photo.png');
    });

    it('enterpriseId 取服务端解析结果，不接受前端传入', async () => {
      enterpriseContext.resolveOrNull.mockResolvedValue({ enterpriseId: 'ent1' });

      const [attachment] = await service.uploadFiles(
        [multerFile('photo.png')],
        'u1',
      );

      expect(storage.buildKey).toHaveBeenCalledWith(
        expect.objectContaining({ enterpriseId: 'ent1', userId: 'u1' }),
      );
      expect(attachment.key.startsWith('ent1/u1/')).toBe(true);
    });

    it('空数组抛 400', async () => {
      await expect(service.uploadFiles([], 'u1')).rejects.toThrow(
        BadRequestException,
      );
    });

    it('超过单次数量上限抛 400', async () => {
      const files = Array.from({ length: 6 }, (_, i) =>
        multerFile(`a${i}.png`),
      );
      await expect(service.uploadFiles(files, 'u1')).rejects.toThrow(
        BadRequestException,
      );
      expect(storage.put).not.toHaveBeenCalled();
    });

    it('校验失败的文件不落存储', async () => {
      await expect(
        service.uploadFiles([multerFile('run.exe')], 'u1'),
      ).rejects.toThrow(BadRequestException);
      expect(storage.put).not.toHaveBeenCalled();
    });

    it('中途失败时回滚已上传的对象，不留孤儿文件', async () => {
      // 第一个成功、第二个非法 —— 第一个必须被删掉
      await expect(
        service.uploadFiles(
          [multerFile('ok.png'), multerFile('bad.exe')],
          'u1',
        ),
      ).rejects.toThrow(BadRequestException);

      expect(storage.put).toHaveBeenCalledTimes(1);
      expect(storage.delete).toHaveBeenCalledWith(
        'personal/u1/1700000000000_abcd_ok.png',
      );
    });

    it('回滚删除本身失败也不掩盖原始错误', async () => {
      storage.delete.mockRejectedValue(new Error('disk gone'));
      await expect(
        service.uploadFiles(
          [multerFile('ok.png'), multerFile('bad.exe')],
          'u1',
        ),
      ).rejects.toThrow(BadRequestException);
    });
  });

  describe('assertOwnership', () => {
    it('放行自己前缀下的 key', async () => {
      await expect(
        service.assertOwnership(['personal/u1/1_a_x.png'], 'u1'),
      ).resolves.toBeUndefined();
    });

    it('拒绝别人的 key', async () => {
      await expect(
        service.assertOwnership(['personal/u2/1_a_x.png'], 'u1'),
      ).rejects.toThrow(ForbiddenException);
    });

    it('拒绝跨企业的 key（同一 userId 也不行）', async () => {
      enterpriseContext.resolveOrNull.mockResolvedValue({ enterpriseId: 'ent1' });
      await expect(
        service.assertOwnership(['ent2/u1/1_a_x.png'], 'u1'),
      ).rejects.toThrow(ForbiddenException);
    });

    it('拒绝用 userId 前缀混淆的 key（u1 vs u10）', async () => {
      await expect(
        service.assertOwnership(['personal/u10/1_a_x.png'], 'u1'),
      ).rejects.toThrow(ForbiddenException);
    });

    it('拒绝试图穿越目录的 key', async () => {
      await expect(
        service.assertOwnership(['../personal/u2/x.png'], 'u1'),
      ).rejects.toThrow(ForbiddenException);
    });

    it('一批里只要有一个越权就整体拒绝', async () => {
      await expect(
        service.assertOwnership(
          ['personal/u1/a.png', 'personal/u2/b.png'],
          'u1',
        ),
      ).rejects.toThrow(ForbiddenException);
    });

    it('空数组直接通过，不触发企业上下文查询', async () => {
      await expect(service.assertOwnership([], 'u1')).resolves.toBeUndefined();
      expect(enterpriseContext.resolveOrNull).not.toHaveBeenCalled();
    });
  });

  describe('refreshUrl', () => {
    it('先校验归属再重签', async () => {
      const url = await service.refreshUrl('personal/u1/a.png', 'u1');
      expect(url).toBe('/uploads/personal/u1/a.png?exp=2&sig=y');
    });

    it('别人的 key 拿不到新链接', async () => {
      await expect(
        service.refreshUrl('personal/u2/a.png', 'u1'),
      ).rejects.toThrow(ForbiddenException);
      expect(storage.getSignedUrl).not.toHaveBeenCalled();
    });
  });
});
