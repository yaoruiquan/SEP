import { ArgumentsHost, BadRequestException, HttpException } from '@nestjs/common';
import { HttpExceptionFilter } from './http-exception.filter';

describe('HttpExceptionFilter', () => {
  const gatewayPath = '/api/gateway/v1/chat/completions';

  function catchException(
    exception: unknown,
    originalUrl = gatewayPath,
    requestId: string | undefined = 'request-123',
    initialHeaders: Record<string, string | number | string[]> = {},
  ) {
    const headers = { 'x-request-id': 'header-request-id', ...initialHeaders };
    const response = {
      status: jest.fn().mockReturnThis(),
      json: jest.fn(),
      getHeader: jest.fn((name: string) => headers[name.toLowerCase()]),
      getHeaders: jest.fn(() => ({ ...headers })),
      setHeader: jest.fn((name: string, value: string) => {
        headers[name.toLowerCase()] = value;
        return response;
      }),
    };
    const host = {
      switchToHttp: () => ({
        getResponse: () => response,
        getRequest: () => ({ originalUrl, requestId }),
      }),
    } as unknown as ArgumentsHost;

    new HttpExceptionFilter().catch(exception, host);
    return { response, body: response.json.mock.calls[0][0] };
  }

  it('adds Retry-After to 429 responses when the producer did not set it', () => {
    const { response } = catchException(new HttpException('Too many requests', 429));

    expect(response.setHeader).toHaveBeenCalledWith('Retry-After', '60');
  });

  it.each(['8', 'Sat, 10 Oct 2026 00:00:18 GMT', 0])(
    'does not overwrite an existing standard Retry-After %p', (retryAfter) => {
      const { response } = catchException(new HttpException({ retryAfterSeconds: 12 }, 429),
        gatewayPath, 'request-123', { 'retry-after': retryAfter, 'retry-after-auth': '30' });
      expect(response.setHeader).not.toHaveBeenCalled();
    },
  );

  it.each([0, 17, 1.2])('prefers exception waiting seconds %p over named headers', (seconds) => {
    const { response } = catchException(new HttpException({ retryAfterSeconds: seconds }, 429),
      gatewayPath, 'request-123', { 'retry-after-auth': '40' });
    expect(response.setHeader).toHaveBeenCalledWith('Retry-After', String(Math.ceil(seconds)));
  });

  it('chooses the maximum valid named wait across multiple throttler rules', () => {
    const { response } = catchException(new HttpException('Throttler exception', 429),
      gatewayPath, 'request-123', {
        'retry-after-default': '7', 'retry-after-auth': '19', 'retry-after-chat': 12,
        'Retry-After-Gateway-Model': ' 15 ', 'x-ratelimit-reset': '99999',
      });
    expect(response.setHeader).toHaveBeenCalledWith('Retry-After', '19');
  });

  it.each(['12', -1, NaN, Infinity, Number.MAX_SAFE_INTEGER + 1, {}, null])(
    'ignores an invalid exception wait %p and uses valid named waiting information', (retryAfterSeconds) => {
      const { response } = catchException(new HttpException({ retryAfterSeconds }, 429),
        gatewayPath, 'request-123', { 'retry-after-auth': '9' });
      expect(response.setHeader).toHaveBeenCalledWith('Retry-After', '9');
    },
  );

  it.each(['', '-1', '1.5', 'Infinity', 'NaN', '12seconds', '9007199254740992', ['12'], -1, Infinity])(
    'uses the compatible fallback for invalid named waiting information %p', (value) => {
      const { response } = catchException(new HttpException('Too many requests', 429),
        gatewayPath, 'request-123', { 'retry-after-auth': value, 'retry-after-': '99' });
      expect(response.setHeader).toHaveBeenCalledWith('Retry-After', '60');
    },
  );

  it('retains zero as a valid named wait and only adds waiting headers for 429', () => {
    const { response } = catchException(new HttpException('Too many requests', 429),
      gatewayPath, 'request-123', { 'retry-after-auth': '0' });
    expect(response.setHeader).toHaveBeenCalledWith('Retry-After', '0');
    const non429 = catchException(new HttpException({ retryAfterSeconds: 10 }, 503));
    expect(non429.response.setHeader).not.toHaveBeenCalled();
  });

  it('applies waiting header precedence without changing the ordinary business envelope', () => {
    const raw = { message: 'Too many requests', retryAfterSeconds: 5, error: { source: 'platform' } };
    const { response, body } = catchException(new HttpException(raw, 429), '/api/employees');
    expect(response.setHeader).toHaveBeenCalledWith('Retry-After', '5');
    expect(body).toEqual({
      statusCode: 429, message: 'Too many requests', requestId: 'request-123',
      timestamp: expect.any(String), path: '/api/employees',
    });
  });

  it('adds an OpenAI error while retaining the legacy envelope for gateway errors', () => {
    const { response, body } = catchException(new BadRequestException('Invalid model'));

    expect(response.status).toHaveBeenCalledWith(400);
    expect(body).toEqual({
      statusCode: 400,
      message: 'Invalid model',
      requestId: 'request-123',
      timestamp: expect.any(String),
      path: gatewayPath,
      error: {
        message: 'Invalid model',
        type: 'invalid_request_error',
        code: null,
        param: null,
        requestId: 'request-123',
      },
    });
  });

  it('preserves validation field paths and exposes a readable message and first param', () => {
    const errors = [
      { field: 'messages.1.tool_calls.0.function.arguments', message: 'Expected string' },
      { field: 'messages.2.tool_call_id', message: 'Required' },
    ];
    const { body } = catchException(new BadRequestException({ message: '请求参数校验失败', errors }));

    expect(body.message).toBe('请求参数校验失败');
    expect(body.errors).toEqual(errors);
    expect(body.error).toEqual({
      message: `请求参数校验失败: ${errors[0].field}: Expected string; ${errors[1].field}: Required`,
      type: 'invalid_request_error',
      code: 'INVALID_PARAMETER',
      param: errors[0].field,
      requestId: 'request-123',
    });
  });

  it('accepts standard nested HttpException errors, copying only safe fields', () => {
    const { body } = catchException(new HttpException({
      error: {
        message: 'Upstream rate limit',
        type: 'rate_limit_error',
        code: 'rate_limit_exceeded',
        param: 'model',
        requestId: 'untrusted-upstream-id',
        headers: { authorization: 'secret' },
        stack: 'private stack',
      },
      debug: 'private debug',
    }, 429));

    expect(body.message).toBe('Upstream rate limit');
    expect(body.error).toEqual({
      message: 'Upstream rate limit',
      type: 'rate_limit_error',
      code: 'rate_limit_exceeded',
      param: 'model',
      requestId: 'request-123',
    });
    expect(JSON.stringify(body)).not.toMatch(/secret|private|untrusted/);
  });

  it('preserves an outer message and explicit null code/param in standard errors', () => {
    const { body } = catchException(new HttpException({
      message: 'Legacy message',
      error: { message: 'SDK message', type: 'custom_error', code: null, param: null },
    }, 422));

    expect(body.message).toBe('Legacy message');
    expect(body.error).toEqual({
      message: 'SDK message', type: 'custom_error', code: null, param: null, requestId: 'request-123',
    });
  });

  it.each(['platform', 'upstream'])('preserves the allowed gateway error source %s', (source) => {
    const { body } = catchException(new HttpException({ error: { message: 'Rate limited', source } }, 429));
    expect(body.error.source).toBe(source);
  });

  it.each(['vendor', 'PLATFORM', '', 1, {}, ['upstream'], null])(
    'does not propagate unsupported gateway source %p', (source) => {
      const { body } = catchException(new HttpException({ error: { source } }, 429));
      expect(body.error).not.toHaveProperty('source');
    },
  );

  it('copies only whitelisted rate limit fields and retains Unix millisecond resetAt', () => {
    const rateLimit = {
      rule: 'gateway-model', dimension: 'enterprise-member-subscription', limit: 60,
      windowMs: 60000, count: 60, retryAfterSeconds: 17, resetAt: 1791580817000,
    };
    const { body } = catchException(new HttpException({
      error: {
        message: 'Platform rate limit', type: 'rate_limit_error', code: 'PLATFORM_RATE_LIMIT_EXCEEDED',
        source: 'platform', rateLimit: { ...rateLimit, identity: { token: 'secret' }, key: 'private' },
      },
      retryAfterSeconds: 17,
    }, 429));
    expect(body.error.rateLimit).toEqual(rateLimit);
    expect(JSON.stringify(body)).not.toMatch(/secret|private|identity/);
    expect(body).not.toHaveProperty('retryAfterSeconds');
  });

  it.each([-1, NaN, Infinity, '12', {}, [], 1.5, Number.MAX_SAFE_INTEGER + 1])(
    'rejects unsafe numeric rate limit fields %p while retaining valid fields', (value) => {
      const { body } = catchException(new HttpException({ error: { rateLimit: {
        rule: 'gateway-model', dimension: { secret: 'private' },
        limit: value, windowMs: value, count: value, retryAfterSeconds: value, resetAt: value,
      } } }, 429));
      expect(body.error.rateLimit).toEqual({ rule: 'gateway-model' });
    },
  );

  it('retains zero-valued safe rate limit numbers', () => {
    const rateLimit = { limit: 0, windowMs: 0, count: 0, retryAfterSeconds: 0, resetAt: 0 };
    const { body } = catchException(new HttpException({ error: { rateLimit } }, 429));
    expect(body.error.rateLimit).toEqual(rateLimit);
  });

  it.each([undefined, null, [], 'private', 1, {}, { extra: 'secret' }])(
    'does not expose malformed or empty rate limit metadata %p', (rateLimit) => {
      const { body } = catchException(new HttpException({ error: { rateLimit } }, 429));
      expect(body.error).not.toHaveProperty('rateLimit');
    },
  );

  it('does not copy unexpected types from a nested error or validation entries', () => {
    const { body } = catchException(new HttpException({
      message: 'Invalid request',
      error: { message: { secret: true }, type: ['private'], code: { secret: true }, param: 1 },
      errors: [null, 'private', { field: 'model', message: 'Required', input: 'secret' }, { field: 1, message: 'private' }],
    }, 400));

    expect(body.errors).toEqual([{ field: 'model', message: 'Required' }]);
    expect(body.error).toEqual({
      message: 'Invalid request: model: Required', type: 'invalid_request_error', code: 'INVALID_PARAMETER',
      param: 'model', requestId: 'request-123',
    });
    expect(JSON.stringify(body)).not.toMatch(/secret|private/);
  });

  it('converts array messages into readable SDK messages without changing the outer message', () => {
    const message = ['model must be a string', 'messages must be an array'];
    const { body } = catchException(new BadRequestException(message));

    expect(body.message).toEqual(message);
    expect(body.error.message).toBe(message.join('; '));
  });

  it('handles string HttpException responses', () => {
    const { body } = catchException(new HttpException('Not authorized', 401));
    expect(body.message).toBe('Not authorized');
    expect(body.error.message).toBe('Not authorized');
  });

  it('falls back to a generic error for unrecognized gateway response objects', () => {
    const { body } = catchException(new HttpException({ debug: 'secret' }, 502));
    expect(body.message).toBe('Internal server error');
    expect(body.error.message).toBe('Internal server error');
    expect(body.error.type).toBe('server_error');
    expect(JSON.stringify(body)).not.toContain('secret');
  });

  it.each([new Error('private credentials'), { message: 'private credentials', error: { message: 'secret' } }])(
    'never exposes raw non-HttpException details: %p',
    (exception) => {
      const { response, body } = catchException(exception);
      expect(response.status).toHaveBeenCalledWith(500);
      expect(body.message).toBe('Internal server error');
      expect(body.error).toEqual({
        message: 'Internal server error', type: 'server_error', code: null, param: null, requestId: 'request-123',
      });
      expect(JSON.stringify(body)).not.toMatch(/private|secret/);
    },
  );

  it('uses the response request id when no request context id is available', () => {
    const { body } = catchException(new BadRequestException('Invalid'), gatewayPath, '');
    expect(body.requestId).toBe('header-request-id');
    expect(body.error.requestId).toBe('header-request-id');
  });

  it('recognizes gateway routes with query strings', () => {
    const path = `${gatewayPath}?stream=false`;
    const { body } = catchException(new BadRequestException('Invalid'), path);
    expect(body.error.message).toBe('Invalid');
    expect(body.path).toBe(path);
  });

  it.each(['/api/employees', '/api/gateway-other/v1/chat/completions', '/api/tasks?next=/api/gateway/v1/chat/completions'])(
    'preserves the exact existing business envelope for %s',
    (path) => {
      const { body } = catchException(new BadRequestException({
        message: '请求参数校验失败', errors: [{ field: 'name', message: 'Required' }],
      }), path);
      expect(body).toEqual({
        statusCode: 400, message: '请求参数校验失败', requestId: 'request-123',
        timestamp: expect.any(String), path,
      });
    },
  );

  it('does not change object responses without a message on ordinary business routes', () => {
    const raw = { error: { message: 'Business error', code: 'business_code' } };
    const { body } = catchException(new HttpException(raw, 409), '/api/employees');
    expect(body.message).toEqual(raw);
    expect(body).not.toHaveProperty('error');
  });
});
