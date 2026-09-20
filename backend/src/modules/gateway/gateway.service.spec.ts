import { BadGatewayException, HttpException } from '@nestjs/common';
import { GatewayService } from './gateway.service';

describe('GatewayService.forwardChatCompletion', () => {
  const dto = { model: 'test-model', messages: [{ role: 'user' as const, content: 'hello' }] };
  let service: GatewayService;
  let fetchMock: jest.SpyInstance;

  beforeEach(() => {
    service = new GatewayService({} as never, {} as never, {} as never);
    jest.spyOn(service, 'getSub2ApiConfig').mockResolvedValue({
      baseUrl: 'https://relay.test/v1/', apiKey: 'test-key', defaultModel: 'test-model',
    });
    fetchMock = jest.spyOn(global, 'fetch');
  });

  afterEach(() => jest.restoreAllMocks());

  it('forwards the validated request only through sub2api', async () => {
    const upstream = new Response('{}');
    fetchMock.mockResolvedValue(upstream);
    expect(await service.forwardChatCompletion(dto)).toBe(upstream);
    expect(fetchMock).toHaveBeenCalledWith('https://relay.test/v1/chat/completions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: 'Bearer test-key' },
      body: JSON.stringify(dto),
    });
  });

  it.each([400, 429, 503])('preserves upstream HTTP %i and structured error details', async (status) => {
    const error = { message: 'invalid tool message', type: 'invalid_request_error', code: 'invalid_tool', param: 'messages[2].tool_call_id' };
    fetchMock.mockResolvedValue(new Response(JSON.stringify({ error }), { status }));
    try {
      await service.forwardChatCompletion(dto);
      throw new Error('Expected upstream rejection');
    } catch (exception) {
      expect(exception).toBeInstanceOf(HttpException);
      expect((exception as HttpException).getStatus()).toBe(status);
      expect((exception as HttpException).getResponse()).toEqual({ error });
    }
  });

  it.each(['', '<html>private proxy diagnostics</html>'])('gives a readable fallback without echoing a raw proxy body', async (body) => {
    fetchMock.mockResolvedValue(new Response(body, { status: 502 }));
    await expect(service.forwardChatCompletion(dto)).rejects.toMatchObject({
      response: { error: { message: 'sub2api 请求失败（HTTP 502）', code: 'UPSTREAM_ERROR' } },
      status: 502,
    });
  });

  it('maps transport failures to 502 without exposing internal connection details', async () => {
    fetchMock.mockRejectedValue(new Error('secret internal connection detail'));
    await expect(service.forwardChatCompletion(dto)).rejects.toBeInstanceOf(BadGatewayException);
  });
});
