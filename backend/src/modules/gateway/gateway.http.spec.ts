import { ExecutionContext, INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { APIError } from 'openai/error';
import { HttpExceptionFilter } from '../../common/filters/http-exception.filter';
import { requestContextMiddleware } from '../../common/middleware/request-context.middleware';
import { ClientEmploymentGuard } from '../client/client-employment.guard';
import { GatewayController } from './gateway.controller';
import { GatewayService } from './gateway.service';

const toolCall = { id: 'call_test_ls_001', type: 'function', function: { name: 'ls', arguments: '{}' } };
const tools = [{ type: 'function', function: { name: 'ls', parameters: { type: 'object' } } }];
const endpoint = '/api/gateway/v1/chat/completions';

// 使用真实 Zod pipe、controller、转发 service 和全局 filter；只 mock 授权/配置/上游。
describe('Gateway tool-call HTTP round trip', () => {
  let app: INestApplication;
  let service: GatewayService;
  let fetchMock: jest.SpyInstance;

  beforeAll(async () => {
    service = new GatewayService({} as never, {} as never, {} as never);
    jest.spyOn(service, 'validateAndAuthorize').mockResolvedValue({
      enterpriseId: 'enterprise-1', subscriptionId: 'subscription-1', memberId: 'member-1',
      allowedModels: ['deepseek-v4.1-flash'],
    });
    jest.spyOn(service, 'getSub2ApiConfig').mockResolvedValue({
      baseUrl: 'https://relay.test/v1', apiKey: 'test-key', defaultModel: 'deepseek-v4.1-flash',
    });
    jest.spyOn(service, 'recordTransaction').mockResolvedValue();
    const moduleRef = await Test.createTestingModule({
      controllers: [GatewayController], providers: [{ provide: GatewayService, useValue: service }],
    }).overrideGuard(ClientEmploymentGuard).useValue({
      canActivate: (context: ExecutionContext) => {
        context.switchToHttp().getRequest().clientEmployment = {};
        return true;
      },
    }).compile();
    app = moduleRef.createNestApplication();
    app.setGlobalPrefix('api');
    app.use(requestContextMiddleware);
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true, forbidNonWhitelisted: true }));
    app.useGlobalFilters(new HttpExceptionFilter());
    await app.init();
  });

  beforeEach(() => { fetchMock = jest.spyOn(global, 'fetch'); });
  afterEach(() => { fetchMock.mockRestore(); });
  afterAll(async () => { await app?.close(); jest.restoreAllMocks(); });

  it.each([false, true])('preserves first and follow-up requests with stream=%s', async (stream) => {
    const assistant = { role: 'assistant', content: null, tool_calls: [toolCall], reasoning_content: 'Inspect files.' };
    const first = { model: 'deepseek-v4.1-flash', messages: [{ role: 'user', content: '列出文件' }], tools, tool_choice: 'auto', stream };
    const second = {
      ...first,
      messages: [...first.messages, assistant, { role: 'tool', tool_call_id: toolCall.id, content: 'a.txt\nb.txt' }],
    };
    // SSE 参数分片保持原样透传，组装工具调用是客户端职责。
    const chunks = [
      { choices: [{ delta: { tool_calls: [{ index: 0, ...toolCall, function: { name: 'ls', arguments: '{' } }] } }] },
      { choices: [{ delta: { tool_calls: [{ index: 0, function: { arguments: '}' } }] } }] },
    ];
    const sse = chunks.map((chunk) => `data: ${JSON.stringify(chunk)}\n\n`).join('') + 'data: [DONE]\n\n';
    fetchMock.mockImplementation(async () => new Response(stream ? sse : JSON.stringify({ choices: [{ message: assistant }] })));
    for (const body of [first, second]) {
      const res = await request(app.getHttpServer()).post(endpoint).send(body).expect(200);
      const [, init] = fetchMock.mock.calls[fetchMock.mock.calls.length - 1];
      expect(JSON.parse(init.body)).toEqual(body);
      if (stream) {
        expect(res.headers['content-type']).toContain('text/event-stream');
        expect(res.text).toBe(sse);
      } else {
        expect(res.body.choices[0].message).toEqual(assistant);
      }
    }
  });

  it('reproduces the SDK no-body message for the legacy nonempty Nest error envelope', () => {
    const error = APIError.generate(400, { statusCode: 400, message: '请求参数校验失败' }, undefined, new Headers());
    expect(error.message).toBe('400 status code (no body)');
  });

  it('returns actionable validation errors instead of the SDK no-body fallback', async () => {
    const res = await request(app.getHttpServer()).post(endpoint).set('x-request-id', 'test-validation').send({
      model: 'deepseek-v4.1-flash', messages: [{ role: 'tool', content: 'a.txt' }], stream: true,
    }).expect(400);
    expect(fetchMock).not.toHaveBeenCalled();
    expect(res.headers['content-type']).toContain('application/json');
    expect(res.body.error).toMatchObject({ code: 'INVALID_PARAMETER', param: 'messages.0.tool_call_id', requestId: 'test-validation' });
    const sdkError = APIError.generate(400, res.body, undefined, new Headers({ 'x-request-id': 'test-validation' }));
    expect(sdkError.message).toContain('tool_call_id');
    expect(sdkError.message).not.toContain('(no body)');
  });

  it.each([400, 429, 503])('returns upstream %s with JSON before any SSE headers', async (status) => {
    const error = { message: 'Tool message rejected', type: 'invalid_request_error', code: 'INVALID_TOOL_MESSAGE', param: 'messages[2].tool_call_id' };
    fetchMock.mockResolvedValue(new Response(JSON.stringify({ error }), { status }));
    const res = await request(app.getHttpServer()).post(endpoint).set('x-request-id', 'test-upstream').send({
      model: 'deepseek-v4.1-flash', messages: [{ role: 'user', content: 'hello' }], stream: true,
    }).expect(status);
    expect(res.headers['content-type']).toContain('application/json');
    expect(res.body.error).toMatchObject({ ...error, requestId: 'test-upstream' });
    expect(res.headers['x-request-id']).toBe('test-upstream');
  });
});
