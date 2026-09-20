import { ArgumentsHost, BadRequestException, HttpException } from '@nestjs/common';
import { HttpExceptionFilter } from './http-exception.filter';

describe('HttpExceptionFilter', () => {
  const gatewayPath = '/api/gateway/v1/chat/completions';

  function catchException(
    exception: unknown,
    originalUrl = gatewayPath,
    requestId: string | undefined = 'request-123',
  ) {
    const response = {
      status: jest.fn().mockReturnThis(),
      json: jest.fn(),
      getHeader: jest.fn().mockReturnValue('header-request-id'),
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
