import { INestApplication } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Test } from '@nestjs/testing';
import { mkdtemp, rm } from 'fs/promises';
import { tmpdir } from 'os';
import { join } from 'path';
import AdmZip from 'adm-zip';
import request from 'supertest';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { PrismaService } from '../../prisma/prisma.service';
import { EnterpriseContextService } from '../enterprise/enterprise-context.service';
import { SkillPackageService } from '../skill-package/skill-package.service';
import { CapabilityContributionController } from './capability-contribution.controller';
import { CapabilityContributionService } from './capability-contribution.service';
import { CapabilityValidatorService } from './capability-validator.service';

/**
 * HTTP 层测试：覆盖 multipart 装配（FileInterceptor + memoryStorage）与
 * 「解析 + 校验」的组合。SkillPackageService 的单测拿不到这一段 ——
 * 它直接喂 Express.Multer.File，绕过了 interceptor。
 */
const SKILL_BODY = '# 角色\n竞品分析助手\n# 输入\n竞品列表\n# 步骤\n1. 收集\n# 输出\n周报';

function zipBuffer(entries: Array<[string, string]>) {
  const zip = new AdmZip();
  for (const [name, content] of entries) zip.addFile(name, Buffer.from(content, 'utf8'));
  return zip.toBuffer();
}

describe('POST /contributions/skill-package', () => {
  let app: INestApplication;
  let root: string;

  beforeAll(async () => {
    root = await mkdtemp(join(tmpdir(), 'sep-skill-http-'));
    const moduleRef = await Test.createTestingModule({
      controllers: [CapabilityContributionController],
      providers: [
        CapabilityValidatorService,
        SkillPackageService,
        { provide: ConfigService, useValue: { get: () => join(root, 'skills') } },
        { provide: CapabilityContributionService, useValue: {} },
        { provide: PrismaService, useValue: {} },
        { provide: EnterpriseContextService, useValue: {} },
      ],
    })
      // 只验上传管线，认证在别处已有覆盖
      .overrideGuard(JwtAuthGuard)
      .useValue({ canActivate: () => true })
      .compile();

    app = moduleRef.createNestApplication();
    await app.init();
  });

  afterAll(async () => {
    await app?.close();
    await rm(root, { recursive: true, force: true });
  });

  it('返回 sha256、包统计、正文与校验结论', async () => {
    const buffer = zipBuffer([['SKILL.md', `---\nname: 竞品周报\n---\n${SKILL_BODY}`]]);

    const res = await request(app.getHttpServer())
      .post('/contributions/skill-package')
      .attach('file', buffer, '竞品周报.zip')
      .expect(201);

    expect(res.body.sha256).toMatch(/^[0-9a-f]{64}$/);
    expect(res.body.fileCount).toBe(1);
    expect(res.body.totalBytes).toBe(buffer.length);
    expect(res.body.content.startsWith('# 角色')).toBe(true);
    expect(res.body.suggested.name).toBe('竞品周报');
    // 上传即校验：这份正文缺 frontmatter 之外的东西都齐了
    expect(res.body.validation.valid).toBe(true);
    expect(res.body.validation.checks.length).toBeGreaterThan(0);
    // kind 是内部字段，不该出现在响应里
    expect(res.body.validation.kind).toBeUndefined();
  });

  it('缺少 SKILL.md 时报 400', () =>
    request(app.getHttpServer())
      .post('/contributions/skill-package')
      .attach('file', zipBuffer([['README.md', SKILL_BODY]]), 'x.zip')
      .expect(400)
      .expect((res) => expect(res.body.message).toContain('SKILL.md')));

  it('正文缺段落时仍然 201，但校验标记未通过', async () => {
    const res = await request(app.getHttpServer())
      .post('/contributions/skill-package')
      .attach('file', zipBuffer([['SKILL.md', '# 角色\n只有角色一段，其他都没写']]), 'thin.zip')
      .expect(201);

    // 解析成功 ≠ 校验通过。草稿可以先建，门禁在提交审核那一步。
    expect(res.body.validation.valid).toBe(false);
    expect(res.body.validation.issues.map((i: { code: string }) => i.code)).toContain(
      'SECTION_INPUT',
    );
  });

  it('没带文件时报 400', () =>
    request(app.getHttpServer()).post('/contributions/skill-package').expect(400));
});
