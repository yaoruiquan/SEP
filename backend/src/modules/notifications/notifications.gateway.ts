import {
  WebSocketGateway,
  WebSocketServer,
  OnGatewayInit,
  OnGatewayConnection,
  OnGatewayDisconnect,
} from '@nestjs/websockets';
import { Logger } from '@nestjs/common';
import { Server, WebSocket } from 'ws';
import { JwtService } from '@nestjs/jwt';
import { forwardRef, Inject } from '@nestjs/common';
import { NotificationsService } from './notifications.service';
import { ConfigService } from '@nestjs/config';

interface AuthenticatedWebSocket extends WebSocket {
  userId?: string;
  authTimer?: NodeJS.Timeout;
}

interface NotificationWebSocketJwtPayload {
  sub?: string;
  type?: string;
}

/**
 * WebSocket 网关 - 实时推送通知
 *
 * 使用原生 WebSocket (ws)，与前端 use-websocket.ts 兼容
 * JWT 在连接建立后通过首条 `auth` JSON 消息传递，不进入 URL 或握手子协议。
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
    @Inject(forwardRef(() => NotificationsService)) private readonly notificationsService: NotificationsService,
    private readonly config: ConfigService,
  ) {}

  afterInit() {
    this.logger.log('WebSocket Gateway initialized: /ws/notifications');
  }

  async handleConnection(client: AuthenticatedWebSocket, req: any) {
    try {
      const origin = req.headers.origin as string | undefined;
      const allowed = (this.config.get<string>('CORS_ORIGIN') ?? '').split(',').map((value) => value.trim()).filter(Boolean);
      // 浏览器连接会带 Origin；Electron/Node 原生客户端通常不会带 Origin，
      // 但仍必须在连接建立后 5 秒内通过 JWT 认证。
      if (allowed.length > 0 && origin && !allowed.includes(origin)) {
        client.close(1008, 'Origin not allowed');
        return;
      }
      client.authTimer = setTimeout(
        () => this.closeClient(client, 1008, 'Authentication timeout'),
        5000,
      );
      client.on('message', async (raw) => {
        try {
          const message = JSON.parse(raw.toString()) as { type?: string; token?: string };

          if (client.userId) {
            if (message.type === 'ping') this.handlePing(client);
            return;
          }

          if (message.type !== 'auth' || !message.token) {
            return this.closeClient(client, 1008, 'Authentication required');
          }
          const payload = this.jwtService.verify<NotificationWebSocketJwtPayload>(
            message.token,
            { secret: this.jwtSecret },
          );
          if (payload.type !== 'access' || !payload.sub) {
            return this.closeClient(client, 1008, 'Invalid token');
          }
          const userId = payload.sub;
          this.clearAuthTimer(client);
          client.userId = userId;
          const clients = this.clients.get(userId) ?? new Set<AuthenticatedWebSocket>();
          clients.add(client); this.clients.set(userId, clients);
          const unreadCount = await this.notificationsService.countUnread(userId);
          this.sendToClient(client, { type: 'connected', data: { unreadCount }, timestamp: Date.now() });
        } catch {
          this.closeClient(client, 1008, 'Invalid token');
        }
      });
    } catch (error) {
      this.logger.error('Connection error:', error);
      this.closeClient(client, 1011, 'Internal error');
    }
  }

  handleDisconnect(client: AuthenticatedWebSocket) {
    this.clearAuthTimer(client);
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

  private clearAuthTimer(client: AuthenticatedWebSocket) {
    if (client.authTimer) {
      clearTimeout(client.authTimer);
      client.authTimer = undefined;
    }
  }

  private closeClient(client: AuthenticatedWebSocket, code: number, reason: string) {
    this.clearAuthTimer(client);
    client.close(code, reason);
  }

  private get jwtSecret(): string {
    return this.config.get<string>('ACCESS_JWT_SECRET') ?? this.config.getOrThrow<string>('JWT_SECRET');
  }
}
