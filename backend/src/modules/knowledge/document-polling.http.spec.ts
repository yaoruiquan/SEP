import { ExecutionContext, INestApplication, UnauthorizedException } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { Test } from '@nestjs/testing';
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';
import request from 'supertest';
import { DocumentController } from './document.controller';
import { DocumentService } from './document.service';
import { KnowledgeAccessPolicy } from './knowledge-access-policy';
import { KnowledgeAuthGuard } from './knowledge-auth.guard';
import { KnowledgeRateLimitGuard } from './knowledge-rate-limit.guard';
import { KnowledgeTestController } from './knowledge-test.controller';
import { KnowledgeTestService } from './knowledge-test.service';

describe('Document polling with real global throttling', () => {
  let app: INestApplication;
  beforeEach(async () => {
    const module = await Test.createTestingModule({
      imports: [ThrottlerModule.forRoot([
        { name: 'default', ttl: 60_000, limit: 3 },
        { name: 'auth', ttl: 60_000, limit: 1 },
        { name: 'chat', ttl: 60_000, limit: 1 },
      ])],
      controllers: [DocumentController, KnowledgeTestController],
      providers: [
        { provide: APP_GUARD, useClass: ThrottlerGuard },
        { provide: DocumentService, useValue: {
          listDocumentsForUser: jest.fn().mockResolvedValue([]),
          getDocumentForUser: jest.fn().mockResolvedValue({ id: 'doc', etag: '"doc"' }),
          listVersions: jest.fn().mockResolvedValue([]),
          preview: jest.fn().mockResolvedValue({ items: [] }),
        } },
        { provide: KnowledgeTestService, useValue: { getDocumentStatus: jest.fn().mockResolvedValue({ documents: [] }) } },
        { provide: KnowledgeAccessPolicy, useValue: { assertRead: jest.fn().mockResolvedValue({ enterpriseId: 'enterprise' }) } },
      ],
    })
      .overrideGuard(KnowledgeAuthGuard).useValue({ canActivate(context: ExecutionContext) {
        const http = context.switchToHttp();
        const req = http.getRequest();
        if (req.headers.authorization !== 'Bearer polling-user') throw new UnauthorizedException();
        req.user = { id: 'user' };
        http.getResponse().setHeader('Cache-Control', 'no-store');
        return true;
      } })
      .overrideGuard(KnowledgeRateLimitGuard).useValue({ canActivate: () => true })
      .compile();
    app = module.createNestApplication();
    app.setGlobalPrefix('api');
    await app.init();
  });
  afterEach(async () => { await app?.close(); });

  const paths = ['/kb/documents', '/kb/documents/doc', '/kb/documents/doc/versions', '/kb/documents/status'];
  it.each(paths.flatMap(path => ['get', 'head'].map(verb => ({ path, verb }))))(
    'allows polling on $verb $path but preserves the default quota', async ({ path, verb }) => {
      for (let i = 0; i < 3; i++) {
        await request(app.getHttpServer())[verb](`/api/knowledge-bases${path}`)
          .set('Authorization', 'Bearer polling-user').expect(200);
      }
      await request(app.getHttpServer())[verb](`/api/knowledge-bases${path}`)
        .set('Authorization', 'Bearer polling-user').expect(429);
    },
  );

  it('does not bypass authentication for polling', async () => {
    await request(app.getHttpServer()).get('/api/knowledge-bases/kb/documents/doc').expect(401);
  });

  it('leaves non-polling handlers under their existing named quotas', async () => {
    const path = '/api/knowledge-bases/kb/documents/doc/preview';
    await request(app.getHttpServer()).get(path).set('Authorization', 'Bearer polling-user').expect(200);
    await request(app.getHttpServer()).get(path).set('Authorization', 'Bearer polling-user').expect(429);
  });
});
