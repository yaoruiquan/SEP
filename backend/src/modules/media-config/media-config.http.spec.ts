import { ExecutionContext, INestApplication, UnauthorizedException, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { ClientController } from '../client/client.controller';
import { ClientService } from '../client/client.service';
import { MediaConfigController } from './media-config.controller';
import { MediaConfigService } from './media-config.service';

describe('media configuration HTTP contracts', () => {
  let app: INestApplication;
  const media = {
    listProfiles: jest.fn().mockResolvedValue([]),
    createProfile: jest.fn().mockResolvedValue({}),
    updateProfile: jest.fn().mockResolvedValue({}),
    getAvailableProfiles: jest.fn().mockResolvedValue([]),
  };
  const client = { getRuntime: jest.fn().mockResolvedValue({ manifestVersion: 1 }) };

  beforeAll(async () => {
    const module = await Test.createTestingModule({
      controllers: [MediaConfigController, ClientController],
      providers: [
        { provide: MediaConfigService, useValue: media },
        { provide: ClientService, useValue: client },
      ],
    }).overrideGuard(JwtAuthGuard).useValue({
      canActivate: (context: ExecutionContext) => {
        const req = context.switchToHttp().getRequest();
        const role = req.headers['x-test-role'];
        if (!role) throw new UnauthorizedException();
        req.user = { id: 'user-1', role };
        return true;
      },
    }).compile();
    app = module.createNestApplication();
    app.setGlobalPrefix('api');
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true, forbidNonWhitelisted: true }));
    await app.init();
  });

  beforeEach(() => jest.clearAllMocks());
  afterAll(async () => app.close());

  it('requires authentication and platform-admin role for admin profiles', async () => {
    await request(app.getHttpServer()).get('/api/admin/media/profiles').expect(401);
    await request(app.getHttpServer()).get('/api/admin/media/profiles').set('x-test-role', 'MEMBER').expect(403);
    expect(media.listProfiles).not.toHaveBeenCalled();
    await request(app.getHttpServer()).get('/api/admin/media/profiles').set('x-test-role', 'ADMIN').expect(200);
    expect(media.listProfiles).toHaveBeenCalledTimes(1);
  });

  it('passes the authenticated identity to the enterprise profile resolver', async () => {
    await request(app.getHttpServer()).get('/api/enterprise/media-config/available-profiles').set('x-test-role', 'MEMBER').expect(200);
    expect(media.getAvailableProfiles).toHaveBeenCalledWith('user-1');
  });

  it('preserves the old runtime contract without a media version', async () => {
    await request(app.getHttpServer()).get('/api/client/subscriptions/sub-1/runtime').set('x-test-role', 'MEMBER').expect(200);
    expect(client.getRuntime).toHaveBeenCalledWith('user-1', 'sub-1', undefined);
  });

  it('parses the media version before passing it to the client service', async () => {
    await request(app.getHttpServer()).get('/api/client/subscriptions/sub-1/runtime?mediaProtocolVersion=1').set('x-test-role', 'MEMBER').expect(200);
    expect(client.getRuntime).toHaveBeenCalledWith('user-1', 'sub-1', 1);
  });

  it('rejects malformed runtime queries before service dispatch', async () => {
    await request(app.getHttpServer()).get('/api/client/subscriptions/sub-1/runtime?mediaProtocolVersion=bad').set('x-test-role', 'MEMBER').expect(400);
    expect(client.getRuntime).not.toHaveBeenCalled();
  });

  it('rejects profile verification injection and updates without an expected version', async () => {
    await request(app.getHttpServer()).post('/api/admin/media/profiles').set('x-test-role', 'ADMIN').send({
      profileId: 'test-image', kind: 'image', displayName: '图片', modelId: 'test-model',
      operations: ['generate'], executionMode: 'sync-response', capabilities: { sizes: ['1024x1024'] },
      verified: true,
    }).expect(400);
    await request(app.getHttpServer()).patch('/api/admin/media/profiles/test-image').set('x-test-role', 'ADMIN').send({ enabled: true }).expect(400);
    expect(media.createProfile).not.toHaveBeenCalled();
    expect(media.updateProfile).not.toHaveBeenCalled();
  });
});
