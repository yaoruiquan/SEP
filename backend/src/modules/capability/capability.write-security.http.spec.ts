import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { CapabilityController } from './capability.controller';
import { CapabilityService } from './capability.service';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { SkillPackageService } from '../skill-package/skill-package.service';
import { SkillVersionService } from '../skill-version/skill-version.service';
import { PrismaService } from '../../prisma/prisma.service';
import { AdapterFactory } from './adapters/adapter.factory';

describe('Capability write HTTP validation', () => {
  let app: INestApplication;
  const prisma = {
    capability: {
      create: jest.fn().mockResolvedValue({ id: 'cap-1' }),
      findUnique: jest.fn().mockResolvedValue({ id: 'cap-1', type: 'AGENT', contributorId: 'user-1' }),
      update: jest.fn().mockResolvedValue({ id: 'cap-1' }),
    },
  };
  const sha256 = 'a'.repeat(64);
  const metadata = { zipPath: `skills/${sha256}.zip`, sha256, fileCount: 1, totalSize: 512 };
  const skill = {
    name: 'Initial skill', description: 'A valid initial description', type: 'skill',
    industry: [], position: [], inputSchema: {}, outputSchema: {},
    skillConfig: { template: '# Initial skill', metadata },
  };

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      controllers: [CapabilityController],
      providers: [
        CapabilityService,
        { provide: PrismaService, useValue: prisma },
        { provide: AdapterFactory, useValue: {} },
        { provide: SkillVersionService, useValue: {} },
        { provide: SkillPackageService, useValue: {} },
      ],
    }).overrideGuard(JwtAuthGuard).useValue({
      canActivate: (context: any) => {
        const req = context.switchToHttp().getRequest();
        req.user = { id: 'user-1', role: req.headers['x-test-role'] ?? 'USER' };
        return true;
      },
    }).compile();
    app = moduleRef.createNestApplication();
    await app.init();
  });

  beforeEach(() => jest.clearAllMocks());
  afterAll(async () => { await app?.close(); });

  it('passes the authenticated admin role and preserves package metadata through the body pipe', async () => {
    await request(app.getHttpServer()).post('/capabilities').set('x-test-role', 'ADMIN')
      .send({ ...skill, enterpriseId: 'forged-enterprise', status: 'APPROVED' }).expect(201);
    const data = prisma.capability.create.mock.calls[0][0].data;
    expect(data).toMatchObject({
      contributorId: 'user-1', platformReviewStatus: 'PENDING_REVIEW',
      metadata: { ...metadata, source: 'ADMIN_CREATED' },
      skillVersions: { create: { status: 'PENDING_PLATFORM_REVIEW',
        packageKey: metadata.zipPath, packageSha256: sha256, packageFileCount: 1 } },
    });
    expect(data).not.toHaveProperty('enterpriseId');
    expect(data).not.toHaveProperty('status', 'APPROVED');
  });

  it('forbids non-admin creation even for a valid payload', async () => {
    await request(app.getHttpServer()).post('/capabilities').send(skill).expect(403);
    expect(prisma.capability.create).not.toHaveBeenCalled();
  });

  it.each([
    { ...skill, type: 'SKILL' },
    { ...skill, description: 'short' },
    { ...skill, skillConfig: undefined },
    { ...skill, type: 'agent' },
    { ...skill, skillConfig: { template: '# Skill', metadata: { zipPath: metadata.zipPath } } },
    { ...skill, skillConfig: { template: '# Skill', metadata: { ...metadata, fileCount: '1' } } },
  ])('returns 400 for an invalid create request before persistence: %j', async (payload) => {
    await request(app.getHttpServer()).post('/capabilities').set('x-test-role', 'ADMIN')
      .send(payload).expect(400);
    expect(prisma.capability.create).not.toHaveBeenCalled();
  });

  it.each([{ type: 'UNKNOWN' }, { description: 'short' }, { inputSchema: 'not-a-schema' }])(
    'validates partial updates before reaching the service: %j', async (payload) => {
      await request(app.getHttpServer()).patch('/capabilities/cap-1').send(payload).expect(400);
      expect(prisma.capability.findUnique).not.toHaveBeenCalled();
      expect(prisma.capability.update).not.toHaveBeenCalled();
    },
  );

  it('rejects AGENT to SKILL conversion over HTTP', async () => {
    await request(app.getHttpServer()).patch('/capabilities/cap-1').send({ type: 'skill' }).expect(400);
    expect(prisma.capability.update).not.toHaveBeenCalled();
  });

  it('accepts partial updates and strips untrusted ownership and status fields', async () => {
    await request(app.getHttpServer()).patch('/capabilities/cap-1')
      .send({ name: 'Renamed', contributorId: 'forged-owner', status: 'APPROVED' }).expect(200);
    expect(prisma.capability.update).toHaveBeenCalledWith(expect.objectContaining({ data: { name: 'Renamed' } }));
  });
});
