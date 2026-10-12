import { readGatewayJson, validGatewayCompletion, validGatewayUsage } from './gateway-response';

describe('Bounded gateway responses', () => {
  it('reads valid JSON and cancels oversized data', async () => {
    expect(await readGatewayJson(new Response('{"ok":true}'), 100)).toEqual({ ok: true });
    const cancel = jest.fn();
    const response = new Response(new ReadableStream({
      start(controller) { controller.enqueue(Buffer.alloc(101)); }, cancel,
    }));
    await expect(readGatewayJson(response, 100)).rejects.toMatchObject({
      response: { error: { code: 'UPSTREAM_RESPONSE_TOO_LARGE' } },
    });
    expect(cancel).toHaveBeenCalled();
  });

  it('does not echo malformed private upstream data', async () => {
    await expect(readGatewayJson(new Response('<html>private diagnostic</html>'), 100)).rejects.toMatchObject({
      response: { error: { code: 'UPSTREAM_INVALID_JSON', message: 'sub2api 返回了无效 JSON' } },
    });
  });

  it('bounds and normalizes usage token values', () => {
    expect(validGatewayUsage({ prompt_tokens: 12, completion_tokens: 8 })).toEqual({ prompt_tokens: 12, completion_tokens: 8, total_tokens: 20 });
    expect(validGatewayUsage({ prompt_tokens: 2147483648, completion_tokens: 0 })).toBeNull();
    expect(validGatewayUsage({ prompt_tokens: 0, completion_tokens: -1 })).toBeNull();
  });

  it.each([null, {}, { choices: [null] }, { choices: [{}] },
    { choices: [{ finish_reason: null, message: { role: 'assistant', content: 'partial' } }] },
    { choices: [{ finish_reason: 'stop', message: { role: 'user', content: 'wrong' } }] },
    { choices: [{ finish_reason: 'stop', message: { role: 'assistant', content: null } }] },
    { choices: [{ finish_reason: 'tool_calls', message: { role: 'assistant', content: '' } }] },
  ])('rejects invalid or incomplete completion %j', (value) => {
    expect(validGatewayCompletion(value)).toBe(false);
  });

  it('accepts assistant text, refusal, and complete tool turns with null content', () => {
    for (const message of [{ role: 'assistant', content: 'ok' }, { role: 'assistant', content: null, refusal: 'no' }]) {
      expect(validGatewayCompletion({ choices: [{ finish_reason: 'stop', message }] })).toBe(true);
    }
    expect(validGatewayCompletion({ choices: [{ finish_reason: 'tool_calls', message: {
      role: 'assistant', content: null,
      tool_calls: [{ id: 'call-1', type: 'function', function: { name: 'ls', arguments: '{}' } }],
    } }] })).toBe(true);
  });
});
