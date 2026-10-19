import { ExecutionContext, INestApplication, UnauthorizedException } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { execFile } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { promisify } from 'node:util';
import fixture from '../../shared/fixtures/media-video-v1.json';
import { HttpExceptionFilter } from '../../common/filters/http-exception.filter';
import { PrismaService } from '../../prisma/prisma.service';
import { ClientEmploymentGuard } from '../client/client-employment.guard';
import { MediaGatewayMockGuard } from './media-gateway-mock.guard';
import { MediaVideoGatewayController } from './media-video-gateway.controller';
import { MediaVideoGatewayService } from './media-video-gateway.service';
import { MediaVideoGatewayStore } from './media-video-gateway.store';
import { createVideoPrismaMock, videoClaims } from './media-video-gateway.test-support';

const clientRoot = process.env.SEP_VIDEO_TEST_CLIENT_ROOT;
const integration = clientRoot ? describe : describe.skip;

// Synthetic employment guard and in-memory Prisma double; transport, controllers,
// store encoding, client HTTP adapter and local disk persistence are real.
// Never uses login, a real model, production services, billing or a real database.
integration('SEP / desktop video mock HTTP and disk roundtrip', () => {
  let app: INestApplication;
  const prisma = createVideoPrismaMock();
  beforeAll(async () => {
    const module = await Test.createTestingModule({
      controllers: [MediaVideoGatewayController], providers: [MediaVideoGatewayService, MediaVideoGatewayStore,
        { provide: PrismaService, useValue: prisma }],
    }).overrideGuard(MediaGatewayMockGuard).useValue({ canActivate: () => true })
      .overrideGuard(ClientEmploymentGuard).useValue({ canActivate(context: ExecutionContext) {
        const request = context.switchToHttp().getRequest();
        if (request.headers['x-test-auth'] !== 'yes' || request.headers.authorization !== 'Bearer synthetic-video-employment-token') throw new UnauthorizedException();
        request.clientEmployment = videoClaims;
        return true;
      } }).compile();
    app = module.createNestApplication();
    app.setGlobalPrefix('api');
    app.useGlobalFilters(new HttpExceptionFilter());
    await app.listen(0, '127.0.0.1');
  });
  afterAll(async () => { await app?.close(); });

  it('uploads, quotes, submits once, resumes original receipt and atomically saves verified video across client restart', async () => {
    expect(JSON.parse(await readFile(resolve(clientRoot!, 'src/shared/fixtures/media-video-v1.json'), 'utf8'))).toEqual(fixture);
    const { stdout } = await promisify(execFile)(process.execPath,
      ['--import', 'tsx', 'scripts/test-video-mock-http.ts'], {
        cwd: resolve(clientRoot!), timeout: 25_000,
        env: { ...process.env, SEP_VIDEO_MOCK_TEST_BASE_URL: `${await app.getUrl()}/api` },
      });
    const result = JSON.parse(stdout.trim());
    expect(result).toMatchObject({ mock: true, billingStatus: 'MOCK_NOT_CHARGED', status: 'SUCCEEDED', saveStatus: 'SAVED',
      byteLength: fixture.mediaFixture.byteLength, sha256: fixture.mediaFixture.sha256,
      counts: { submit: 1, quote: 1, content: 1 } });
    expect(prisma.state.requests.size).toBe(1);
    expect(prisma.mediaGatewayRequest.create).toHaveBeenCalledTimes(1);
    expect(prisma.state.requests.get(result.receiptId)?.status).toBe('SUCCEEDED');
  }, 30_000);
});
