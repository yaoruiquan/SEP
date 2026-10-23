import { ExecutionContext, INestApplication, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { AccountClosureController } from './account-closure.controller';
import { AccountClosureService } from './account-closure.service';
import { JwtAuthGuard } from './jwt-auth.guard';

describe('AccountClosureController HTTP contract', () => {
  let app: INestApplication;
  const token = 'a'.repeat(43);
  const service = {
    eligibility: jest.fn().mockResolvedValue({ eligible: true, gracePeriodDays: 7, blockers: [] }),
    requestVerification: jest.fn().mockResolvedValue({ message: 'sent' }),
    request: jest.fn().mockResolvedValue({ requestId: 'r1', status: 'PENDING', scheduledFor: '2026-10-30T00:00:00Z' }),
    previewCancellation: jest.fn().mockResolvedValue({ canCancel: true }),
    cancel: jest.fn().mockResolvedValue({ message: 'cancelled' }),
    recover: jest.fn().mockResolvedValue({ message: 'processed' }),
  };

  beforeAll(async () => {
    const module = await Test.createTestingModule({
      controllers: [AccountClosureController],
      providers: [
        { provide: AccountClosureService, useValue: service },
        { provide: ConfigService, useValue: { get: (key: string) => key === 'NODE_ENV' ? 'test' : undefined } },
      ],
    }).overrideGuard(JwtAuthGuard).useValue({ canActivate(ctx: ExecutionContext) {
      const req = ctx.switchToHttp().getRequest();
      if (!req.headers.authorization) throw new UnauthorizedException();
      req.user = { id: 'u1' }; return true;
    } }).compile();
    app = module.createNestApplication();
    await app.init();
  });
  beforeEach(() => jest.clearAllMocks());
  afterAll(async () => app?.close());

  it('requires login on eligibility, verification and application', async () => {
    await request(app.getHttpServer()).get('/auth/account-closure/eligibility').expect(401);
    await request(app.getHttpServer()).post('/auth/account-closure/verification').expect(401);
    await request(app.getHttpServer()).post('/auth/account-closure').send({ token, confirmation: '注销账号' }).expect(401);
    expect(service.request).not.toHaveBeenCalled();
  });

  it('uses authenticated identity and validates explicit confirmation before service invocation', async () => {
    await request(app.getHttpServer()).post('/auth/account-closure').set('Authorization', 'Bearer test').send({ token, confirmation: 'yes' }).expect(400);
    expect(service.request).not.toHaveBeenCalled();
    const res = await request(app.getHttpServer()).post('/auth/account-closure').set('Authorization', 'Bearer test').send({ token, confirmation: '注销账号', userId: 'other' }).expect(200);
    expect(service.request).toHaveBeenCalledWith('u1', { token, confirmation: '注销账号' });
    expect(res.headers['set-cookie'][0]).toMatch(/refresh_token=;/);
    expect(res.headers['set-cookie'][0]).toContain('HttpOnly');
  });

  it('GET cancellation only previews and POST cancellation uses the dedicated public credential', async () => {
    await request(app.getHttpServer()).get('/auth/account-closure/cancel').query({ token }).expect(200);
    expect(service.previewCancellation).toHaveBeenCalledWith(token);
    expect(service.cancel).not.toHaveBeenCalled();
    await request(app.getHttpServer()).post('/auth/account-closure/cancel').send({ token }).expect(200);
    expect(service.cancel).toHaveBeenCalledWith(token);
  });

  it('rejects missing and malformed credentials on both public cancellation endpoints', async () => {
    await request(app.getHttpServer()).get('/auth/account-closure/cancel').query({ token: 'bad' }).expect(400);
    await request(app.getHttpServer()).post('/auth/account-closure/cancel').send({}).expect(400);
    expect(service.previewCancellation).not.toHaveBeenCalled();
    expect(service.cancel).not.toHaveBeenCalled();
  });

  it('normalizes public recovery email using shared validation', async () => {
    await request(app.getHttpServer()).post('/auth/account-closure/recovery').send({ email: 'bad' }).expect(400);
    expect(service.recover).not.toHaveBeenCalled();
    await request(app.getHttpServer()).post('/auth/account-closure/recovery').send({ email: ' Member@Example.com ' }).expect(200);
    expect(service.recover).toHaveBeenCalledWith('member@example.com', expect.any(String));
  });
});
