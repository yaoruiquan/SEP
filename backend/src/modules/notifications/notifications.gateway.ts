import {
  WebSocketGateway,
  WebSocketServer,
  OnGatewayInit,
  OnGatewayConnection,
  OnGatewayDisconnect,
  SubscribeMessage,
} from '@nestjs/websockets';
import { Logger } from '@nestjs/common';
import { Server, WebSocket } from 'ws';
import { JwtService } from '@nestjs/jwt';
import { NotificationsService } from './notifications.service';

interface AuthenticatedWebSocket extends WebSocket {
  userId?: string;
}

/**
 * WebSocket 网关 - 实时推送通知
 *
 * 使用原生 WebSocket (ws)，与前端 use-websocket.ts 兼容
 * 连接 URL: ws://localhost:3001/ws/notifications?token=<JWT>
 */
@WebSocketGateway({ path: '/ws/notifications' })
export class NotificationsGateway
  implements OnGatewayInit, OnGatewayConnection, OnGatewayDisconnect
{
  @WebSocketServer()
  server: Server;

  private readonly logger = new Logger(NotificationsGateway.name);
  private readonly clients = new Map<string, Set<AuthenticatedWebSocket>>();

  constructor(
    private readonly jwtService: JwtService,
    private readonly notificationsService: NotificationsService,
  ) {}

  afterInit() {
    this.logger.log('WebSocket Gateway initialized: /ws/notifications');
  }

  async handleConnection(client: AuthenticatedWebSocket, req: any) {
    try {
      // 从查询参数中提取 token
      const url = new URL(req.url, `http://${req.headers.host}`);
      const token = url.searchParams.get('token');

      if (!token) {
        this.logger.warn('Connection rejected: missing token');
        client.close(1008, 'Missing token');
        return;
      }

      // 验证 JWT
      const payload = this.jwtService.verify(token);
      const userId = payload.sub;

      if (!userId) {
        this.logger.warn('Connection rejected: invalid token');
        client.close(1008, 'Invalid token');
        return;
      }

      // 绑定用户 ID 到 WebSocket
      client.userId = userId;

      // 注册客户端
      if (!this.clients.has(userId)) {
        this.clients.set(userId, new Set());
      }
      this.clients.get(userId)!.add(client);

      this.logger.log(`Client connected: userId=${userId}, total=${this.clients.get(userId)!.size}`);

      // 发送欢迎消息 + 未读数
      const unreadCount = await this.notificationsService.countUnread(userId);
      this.sendToClient(client, {
        type: 'connected',
        data: { unreadCount },
        timestamp: Date.now(),
      });
    } catch (error) {
      this.logger.error('Connection error:', error);
      client.close(1011, 'Internal error');
    }
  }

  handleDisconnect(client: AuthenticatedWebSocket) {
    const userId = client.userId;
    if (userId) {
      const userClients = this.clients.get(userId);
      if (userClients) {
        userClients.delete(client);
        if (userClients.size === 0) {
          this.clients.delete(userId);
        }
      }
      this.logger.log(`Client disconnected: userId=${userId}`);
    }
  }

  /**
   * 心跳 ping - 前端每 30s 发送一次
   */
  @SubscribeMessage('ping')
  handlePing(client: AuthenticatedWebSocket) {
    this.sendToClient(client, { type: 'pong', timestamp: Date.now() });
  }

  /**
   * 推送通知给指定用户（所有在线客户端）
   */
  async pushToUser(userId: string, notification: any) {
    const userClients = this.clients.get(userId);
    if (!userClients || userClients.size === 0) {
      this.logger.debug(`User ${userId} not connected, skipping push`);
      return;
    }

    const message = {
      type: 'notification',
      data: notification,
      timestamp: Date.now(),
    };

    userClients.forEach((client) => {
      this.sendToClient(client, message);
    });

    this.logger.debug(`Pushed notification to ${userClients.size} client(s) for userId=${userId}`);
  }

  /**
   * 推送未读数更新
   */
  async pushUnreadCount(userId: string, count: number) {
    const userClients = this.clients.get(userId);
    if (!userClients || userClients.size === 0) return;

    const message = {
      type: 'unread_count',
      data: { count },
      timestamp: Date.now(),
    };

    userClients.forEach((client) => {
      this.sendToClient(client, message);
    });
  }

  private sendToClient(client: WebSocket, message: any) {
    if (client.readyState === WebSocket.OPEN) {
      client.send(JSON.stringify(message));
    }
  }
}
