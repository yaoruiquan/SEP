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

describe('NotificationsGateway', () => {
  it('只在认证时读取一次未读数，事件推送不会轮询数据库', async () => {
    const jwtService = { verify: jest.fn().mockReturnValue({ sub: 'user-1' }) };
    const notificationsService = { countUnread: jest.fn().mockResolvedValue(3) };
    const gateway = new NotificationsGateway(
      jwtService as any,
      notificationsService as any,
      { get: jest.fn().mockReturnValue('') } as any,
    );
    const client = createClient();

    await gateway.handleConnection(client, { headers: {} });
    client.emit('message', Buffer.from(JSON.stringify({ type: 'auth', token: 'jwt-token' })));
    await new Promise<void>((resolve) => setImmediate(resolve));

    expect(notificationsService.countUnread).toHaveBeenCalledTimes(1);
    expect(JSON.parse(client.send.mock.calls[0][0])).toEqual(
      expect.objectContaining({ type: 'connected', data: { unreadCount: 3 } }),
    );

    await gateway.pushToUser('user-1', { id: 'notification-1' });
    await gateway.pushUnreadCount('user-1', 2);
    expect(notificationsService.countUnread).toHaveBeenCalledTimes(1);
    expect(client.send).toHaveBeenCalledTimes(3);

    gateway.handleDisconnect(client);
  });
});
