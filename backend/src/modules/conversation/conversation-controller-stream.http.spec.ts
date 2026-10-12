import {
  ExecutionContext,
  HttpException,
  INestApplication,
  Logger,
} from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { HttpExceptionFilter } from '../../common/filters/http-exception.filter';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { ConversationController } from './conversation.controller';
import { ConversationService } from './conversation.service';
import { ConversationStreamService } from './conversation-stream.service';

describe('ConversationController first-event HTTP contract', () => {
  let app: INestApplication;
  const streamConversation = jest.fn();
  const endpoint = '/api/conversations/session-1/messages';

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      controllers: [ConversationController],
      providers: [
        { provide: ConversationService, useValue: {} },
        {
          provide: ConversationStreamService,
          useValue: { streamConversation },
        },
      ],
    })
      .overrideGuard(JwtAuthGuard)
      .useValue({
        canActivate(context: ExecutionContext) {
          context.switchToHttp().getRequest().user = {
            id: 'user-1',
            email: 'user@example.test',
            role: 'USER',
          };
          return true;
        },
      })
      .compile();
    app = moduleRef.createNestApplication();
    app.setGlobalPrefix('api');
    app.useGlobalFilters(new HttpExceptionFilter());
    await app.init();
  });

  beforeEach(() => {
    streamConversation.mockReset();
    jest.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
  });
  afterEach(() => jest.restoreAllMocks());
  afterAll(async () => {
    await app?.close();
  });

  it('returns pre-event platform 429 as JSON HTTP with Retry-After, not a 200 SSE error', async () => {
    const rejection = {
      error: {
        message: 'Model request limited',
        code: 'PLATFORM_ADMISSION_REJECTED',
        source: 'platform',
        policyVersion: 27,
        rule: 'member-rpm',
        dimension: 'enterprise/member',
        limit: 120,
        count: 120,
        resetAt: 1791778000000,
        retryAfterSeconds: 3,
      },
      retryAfterSeconds: 3,
    };
    streamConversation.mockImplementation(async function* () {
      throw new HttpException(rejection, 429);
    });
    const result = await request(app.getHttpServer())
      .post(endpoint)
      .send({ content: 'Hello' })
      .expect(429);
    expect(result.headers['content-type']).toContain('application/json');
    expect(result.headers['retry-after']).toBe('3');
    expect(result.headers['x-accel-buffering']).toBeUndefined();
    expect(result.body).toMatchObject({
      statusCode: 429,
      error: rejection.error,
    });
    expect(result.text).not.toContain('event:');
    expect(streamConversation).toHaveBeenCalledWith(
      'session-1',
      'Hello',
      'user-1',
      undefined,
      undefined,
      expect.any(AbortSignal),
      expect.any(Function),
    );
  });

  it('returns a successful SSE stream as HTTP 200 and exactly one service-provided done', async () => {
    streamConversation.mockImplementation(async function* () {
      yield { event: 'text_delta', data: { text: 'Hello' } };
      yield { event: 'done', data: { messageId: 'message-1' } };
    });
    const result = await request(app.getHttpServer())
      .post(endpoint)
      .send({ content: 'Hello' })
      .expect(200);
    expect(result.headers['content-type']).toContain('text/event-stream');
    expect(result.headers['x-accel-buffering']).toBe('no');
    expect(result.text).toBe(
      'event: text_delta\ndata: {"text":"Hello"}\n\nevent: done\ndata: {"messageId":"message-1"}\n\n',
    );
  });
});
