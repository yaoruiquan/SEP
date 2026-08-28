import { BadRequestException, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { mkdtemp, rm } from 'fs/promises';
import { tmpdir } from 'os';
import { join } from 'path';
import AdmZip from 'adm-zip';
import { SkillPackageService } from './skill-package.service';

const SKILL_BODY = [
  '# 角色',
  '你是竞品分析助手。',
  '# 输入',
  '竞品名称列表',
  '# 步骤',
  '1. 收集公开资料',
  '# 输出',
  '一份周报',
].join('\n');

function zipWith(entries: Array<[string, string]>): Buffer {
  const zip = new AdmZip();
  for (const [name, content] of entries) zip.addFile(name, Buffer.from(content, 'utf8'));
  return zip.toBuffer();
}

/**
 * 造带恶意条目名的包。
 * AdmZip 的 addFile 会把 `../../evil.sh` 规范成 `evil.sh`、把 `/etc/x` 规范成
 * `etc/x`，所以先用安全名写入，再直接改 entryName —— 改后的名字能活到 zip
 * 字节里，这才是攻击者真正会送上来的形态。
 */
function zipWithRawName(maliciousName: string): Buffer {
  const zip = new AdmZip();
  zip.addFile('SKILL.md', Buffer.from(SKILL_BODY, 'utf8'));
  zip.addFile('placeholder.txt', Buffer.from('x', 'utf8'));
  const planted = zip.getEntries().find((entry) => entry.entryName === 'placeholder.txt');
  if (!planted) throw new Error('fixture 失效：找不到待改名的条目');
  planted.entryName = maliciousName;
  return zip.toBuffer();
}

function upload(buffer: Buffer, originalname = 'skill.zip'): Express.Multer.File {
  return { buffer, originalname, size: buffer.length } as Express.Multer.File;
}

describe('SkillPackageService', () => {
  let root: string;
  let service: SkillPackageService;

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), 'sep-skill-pkg-'));
    service = new SkillPackageService({
      get: () => join(root, 'skills'),
    } as unknown as ConfigService);
  });

  afterEach(async () => {
    await rm(root, { recursive: true, force: true });
  });

  describe('store', () => {
    it('解析 SKILL.md 正文、剥掉 frontmatter，并按 sha256 落盘', async () => {
      const buffer = zipWith([
        ['SKILL.md', `---\nname: 竞品周报\ndescription: 生成竞品周报\n---\n${SKILL_BODY}`],
      ]);
      const stored = await service.store(upload(buffer, '竞品周报.zip'));

      expect(stored.content.startsWith('# 角色')).toBe(true);
      expect(stored.content).not.toContain('---');
      expect(stored.key).toBe(`skills/${stored.sha256}.zip`);
      expect(stored.fileCount).toBe(1);
      expect(stored.totalBytes).toBe(buffer.length);
      // frontmatter 用于预填第三步的能力信息
      expect(stored.suggested).toEqual({ name: '竞品周报', description: '生成竞品周报' });
      // 落盘后能按 sha256 重新读回同一份正文
      await expect(service.read(stored.sha256)).resolves.toMatchObject({
        content: stored.content,
        fileCount: 1,
      });
    });

    it('同一份包重复上传落同一个 key（内容寻址去重）', async () => {
      const buffer = zipWith([['SKILL.md', SKILL_BODY]]);
      const first = await service.store(upload(buffer));
      const second = await service.store(upload(buffer, '另一个名字.zip'));
      expect(second.sha256).toBe(first.sha256);
      expect(second.key).toBe(first.key);
    });

    it('没有 frontmatter 时 suggested 为空，不编造预填值', async () => {
      const stored = await service.store(upload(zipWith([['SKILL.md', SKILL_BODY]])));
      expect(stored.suggested).toEqual({ name: null, description: null });
    });

    it('接受嵌在子目录里的 SKILL.md', async () => {
      const stored = await service.store(
        upload(zipWith([['weekly/SKILL.md', SKILL_BODY], ['weekly/ref.md', '附件']])),
      );
      expect(stored.fileCount).toBe(2);
      expect(stored.content.startsWith('# 角色')).toBe(true);
    });
  });

  describe('拒绝非法包', () => {
    const reject = (file: Express.Multer.File) =>
      expect(service.store(file)).rejects.toBeInstanceOf(BadRequestException);

    it('拒绝空上传', () => reject(upload(Buffer.alloc(0))));

    it('拒绝非 .zip 扩展名', () =>
      reject(upload(zipWith([['SKILL.md', SKILL_BODY]]), 'skill.tar.gz')));

    it('拒绝改名成 .zip 的非 zip 内容（魔数校验）', () =>
      reject(upload(Buffer.from('这不是 zip，只是改了后缀'), 'fake.zip')));

    it('拒绝缺少 SKILL.md 的包', () =>
      reject(upload(zipWith([['README.md', SKILL_BODY]]))));

    it('不把 NOTSKILL.md 当成 SKILL.md（按 basename 精确匹配）', () =>
      reject(upload(zipWith([['NOTSKILL.md', SKILL_BODY]]))));

    it('拒绝 SKILL.md 正文为空', () =>
      reject(upload(zipWith([['SKILL.md', '---\nname: 空\n---\n   \n']]))));

    it('拒绝含路径穿越条目的包', () => reject(upload(zipWithRawName('../../evil.sh'))));

    it('拒绝绝对路径条目', () => reject(upload(zipWithRawName('/etc/cron.d/evil'))));

    it('拒绝 Windows 盘符条目', () => reject(upload(zipWithRawName('C:\\evil.bat'))));

    it('拒绝反斜杠伪装的穿越条目', () => reject(upload(zipWithRawName('..\\..\\evil.sh'))));

    it('拒绝条目数超限的包', () => {
      const entries: Array<[string, string]> = [['SKILL.md', SKILL_BODY]];
      for (let i = 0; i < 600; i += 1) entries.push([`pad/${i}.txt`, 'x']);
      return reject(upload(zipWith(entries)));
    });

    it('拒绝解压后体积超限的包（压缩比炸弹）', () => {
      // 65MB 的可压缩内容压成很小的 zip —— 只看 zip 体积拦不住。
      const bomb = zipWith([['SKILL.md', SKILL_BODY], ['bomb.txt', 'a'.repeat(65 * 1024 * 1024)]]);
      expect(bomb.length).toBeLessThan(1024 * 1024);
      return reject(upload(bomb));
    });
  });

  describe('read', () => {
    it('sha256 格式非法时报 400', () =>
      expect(service.read('not-a-hash')).rejects.toBeInstanceOf(BadRequestException));

    it('包不存在时报 404', () =>
      expect(service.read('a'.repeat(64))).rejects.toBeInstanceOf(NotFoundException));
  });

  describe('resolveStoredPath', () => {
    it('把 key 解成存储根下的绝对路径', async () => {
      const stored = await service.store(upload(zipWith([['SKILL.md', SKILL_BODY]])));
      expect(service.resolveStoredPath(stored.key)).toBe(
        join(root, 'skills', `${stored.sha256}.zip`),
      );
    });

    it.each([
      ['纯穿越', '../../../etc/passwd'],
      ['前缀内穿越', 'skills/../../etc/passwd'],
      ['反斜杠穿越', 'skills\\..\\..\\etc\\passwd'],
      ['缺少 skills/ 前缀', 'chat/other-user-file.png'],
      ['绝对路径', '/etc/passwd'],
    ])('拒绝越界的 key（%s）', (_label, key) => {
      expect(() => service.resolveStoredPath(key)).toThrow(BadRequestException);
    });
  });
});
