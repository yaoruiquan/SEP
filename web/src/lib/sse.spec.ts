import { beforeEach, describe, expect, it, vi } from 'vitest';
import { authAccessor } from './auth-store';

const { tryRefresh } = vi.hoisted(() => ({ tryRefresh: vi.fn() }));

vi.mock('./api-client', () => ({
  API_BASE: '/api',
  tryRefresh,
}));

import { streamTaskExecution } from './sse';

function streamResponse(frame: unknown): Response {
  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(new TextEncoder().encode(`event: snapshot\ndata: ${JSON.stringify(frame)}\n\n`));
      controller.close();
    },
  });
  return new Response(body, { status: 200, headers: { 'Content-Type': 'text/event-stream' } });
}

describe('streamTaskExecution', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    tryRefresh.mockReset();
    authAccessor.clear();
  });

  it('access token 过期时刷新并重连，而不是无限重试 401', async () => {
    const frame = { type: 'snapshot', snapshot: { id: 'run-1', status: 'running' } };
    tryRefresh.mockImplementation(async () => {
      authAccessor.setAuth({
        token: 'fresh-token',
        user: { id: 'u1', email: 'u1@example.com', name: null, avatar: null, role: 'USER' },
        enterprise: null,
        roleInEnterprise: null,
      });
      return true;
    });
    const fetchMock = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(new Response(JSON.stringify({ message: 'Unauthorized' }), { status: 401 }))
      .mockResolvedValueOnce(streamResponse(frame));

    const messages = [];
    for await (const message of streamTaskExecution('run-1')) messages.push(message);

    expect(tryRefresh).toHaveBeenCalledOnce();
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(fetchMock.mock.calls[1]?.[1]).toEqual(
      expect.objectContaining({ headers: expect.objectContaining({ Authorization: 'Bearer fresh-token' }) }),
    );
    expect(messages[0]?.data).toEqual(frame);
  });
});
