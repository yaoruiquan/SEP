import { EventEmitter } from 'node:events';
import { WebSocket } from 'ws';
import { NotificationsGateway } from './notifications.gateway';

function createClient() {
  return Object.assign(new EventEmitter(), {
    readyState: WebSocket.OPEN,
    send: jest.fn(),
    close: jest.fn(),
  }) as any;
}

function createConfig(origin = '') {
  return {
    get: jest.fn((key: string) => {
      if (key === 'ACCESS_JWT_SECRET') return 'access-secret';
      if (key === 'CORS_ORIGIN') return origin;
      return undefined;
    }),
    getOrThrow: jest.fn().mockReturnValue('jwt-secret'),
  } as any;
}

async function flushMessageHandler() {
  await new Promise<void>((resolve) => setImmediate(resolve));
}

describe('NotificationsGateway', () => {
  it('只在认证时读取一次未读数，事件推送不会轮询数据库', async () => {
    const jwtService = {
      verify: jest.fn().mockReturnValue({ sub: 'user-1', type: 'access' }),
    };
    const notificationsService = { countUnread: jest.fn().mockResolvedValue(3) };
    const gateway = new NotificationsGateway(
      jwtService as any,
      notificationsService as any,
      createConfig(),
    );
    const client = createClient();

    // 无 Origin 是桌面客户端的正常连接形态。
    await gateway.handleConnection(client, { headers: {} });
    client.emit('message', Buffer.from(JSON.stringify({ type: 'auth', token: 'jwt-token' })));
    await flushMessageHandler();

    expect(jwtService.verify).toHaveBeenCalledWith('jwt-token', { secret: 'access-secret' });
    expect(notificationsService.countUnread).toHaveBeenCalledTimes(1);
    expect(JSON.parse(client.send.mock.calls[0][0])).toEqual(
      expect.objectContaining({ type: 'connected', data: { unreadCount: 3 } }),
    );

    client.emit('message', Buffer.from(JSON.stringify({ type: 'ping' })));
    await flushMessageHandler();
    expect(JSON.parse(client.send.mock.calls[1][0])).toEqual(
      expect.objectContaining({ type: 'pong' }),
    );

    await gateway.pushToUser('user-1', { id: 'notification-1' });
    await gateway.pushUnreadCount('user-1', 2);
    expect(notificationsService.countUnread).toHaveBeenCalledTimes(1);
    expect(client.send).toHaveBeenCalledTimes(4);

    gateway.handleDisconnect(client);
  });

  it('拒绝 refresh/employment 等非 access token，避免错误令牌订阅通知流', async () => {
    const jwtService = {
      verify: jest.fn().mockReturnValue({ sub: 'user-1', type: 'client-employment' }),
    };
    const notificationsService = { countUnread: jest.fn() };
    const gateway = new NotificationsGateway(
      jwtService as any,
      notificationsService as any,
      createConfig(),
    );
    const client = createClient();

    await gateway.handleConnection(client, { headers: {} });
    client.emit('message', Buffer.from(JSON.stringify({ type: 'auth', token: 'employment-token' })));
    await flushMessageHandler();

    expect(client.close).toHaveBeenCalledWith(1008, 'Invalid token');
    expect(notificationsService.countUnread).not.toHaveBeenCalled();
  });

  it('有 Origin 时拒绝未配置来源', async () => {
    const gateway = new NotificationsGateway(
      { verify: jest.fn() } as any,
      { countUnread: jest.fn() } as any,
      createConfig('https://sep.example.com'),
    );
    const client = createClient();

    await gateway.handleConnection(client, { headers: { origin: 'https://evil.example.com' } });

    expect(client.close).toHaveBeenCalledWith(1008, 'Origin not allowed');
  });
});
