import { INestApplication, NotFoundException, UnauthorizedException } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import helmet from 'helmet';
import request from 'supertest';
import { UserAvatarController, UserController } from './user.controller';
import { UserService } from './user.service';
import { AuthService } from '../auth/auth.service';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { EnterpriseLogoController } from '../enterprise/enterprise-logo.controller';
import { EnterpriseLogoService } from '../enterprise/enterprise-logo.service';

describe('public profile image HTTP resource policy', () => {
  let app: INestApplication;
  const buffer = Buffer.from('89504e470d0a1a0a00000000', 'hex');
  const users = { readAvatar: jest.fn() };
  const logos = { read: jest.fn() };
  const filename = '9a8f39ad-b537-4302-8fd3-56c855376fb3.png';
  const paths = [`/api/users/avatars/${filename}`, `/api/enterprise/logos/${filename}`];

  beforeAll(async () => {
    const module = await Test.createTestingModule({
      controllers: [UserAvatarController, UserController, EnterpriseLogoController],
      providers: [
        { provide: UserService, useValue: users },
        { provide: EnterpriseLogoService, useValue: logos },
        { provide: AuthService, useValue: {} },
      ],
    }).overrideGuard(JwtAuthGuard).useValue({ canActivate() { throw new UnauthorizedException(); } }).compile();
    app = module.createNestApplication();
    app.use(helmet({ contentSecurityPolicy: false }));
    app.setGlobalPrefix('api');
    await app.init();
  });

  beforeEach(() => {
    jest.resetAllMocks();
    users.readAvatar.mockResolvedValue({ buffer, mime: 'image/png' });
    logos.read.mockResolvedValue({ buffer, mime: 'image/png' });
  });

  afterAll(async () => app?.close());

  it.each(paths)('allows cross-origin embedding of published images at %s without login', async path => {
    const result = await request(app.getHttpServer()).get(path)
      .set('Origin', 'http://localhost:5173')
      .expect(200)
      .expect('Cross-Origin-Resource-Policy', 'cross-origin')
      .expect('Content-Type', /image\/png/)
      .expect('X-Content-Type-Options', 'nosniff')
      .expect('Cache-Control', 'public, max-age=86400');
    expect(result.body).toEqual(buffer);
    expect(path.includes('/users/') ? users.readAvatar : logos.read).toHaveBeenCalledWith(filename);
  });

  it('retains authentication and the default resource policy on protected routes', async () => {
    for (const [method, path] of [['get', '/api/users/me'], ['post', '/api/users/me/avatar'], ['post', '/api/enterprise/logo']] as const) {
      await request(app.getHttpServer())[method](path)
        .expect(401)
        .expect('Cross-Origin-Resource-Policy', 'same-origin');
    }
  });

  it('preserves not-found responses for unavailable images', async () => {
    users.readAvatar.mockRejectedValue(new NotFoundException());
    logos.read.mockRejectedValue(new NotFoundException());
    for (const path of paths) {
      await request(app.getHttpServer()).get(path)
        .expect(404)
        .expect('Cross-Origin-Resource-Policy', 'same-origin');
    }
  });
});
