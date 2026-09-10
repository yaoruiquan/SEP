import { WebSocketGateway, WebSocketServer, OnGatewayConnection, OnGatewayDisconnect } from '@nestjs/websockets';
import { Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { Server, WebSocket } from 'ws';
import { EnterpriseService } from './enterprise.service';
import { ConfigService } from '@nestjs/config';

interface Client extends WebSocket { userId?: string; authTimer?: NodeJS.Timeout }

@WebSocketGateway({ path: '/ws/employee-status' })
export class EmployeeStatusGateway implements OnGatewayConnection, OnGatewayDisconnect, OnModuleInit, OnModuleDestroy {
  @WebSocketServer() server!: Server;
  private readonly logger = new Logger(EmployeeStatusGateway.name);
  private readonly clients = new Map<string, Set<Client>>();
  private timer?: NodeJS.Timeout;

  constructor(private readonly jwt: JwtService, private readonly enterprise: EnterpriseService, private readonly config: ConfigService) {}

  onModuleInit() { this.timer = setInterval(() => void this.broadcast(), 1000); }
  onModuleDestroy() { if (this.timer) clearInterval(this.timer); }

  async handleConnection(client: Client, req: any) {
    try {
      const origin = req.headers.origin as string | undefined;
      const allowed = (this.config.get<string>('CORS_ORIGIN') ?? '').split(',').map((value) => value.trim()).filter(Boolean);
      if (allowed.length > 0 && (!origin || !allowed.includes(origin))) {
        return client.close(1008, 'Origin not allowed');
      }
      client.authTimer = setTimeout(() => client.close(1008, 'Authentication timeout'), 5000);
      client.on('message', async (raw) => {
        if (client.userId) return;
        try {
          const message = JSON.parse(raw.toString()) as { type?: string; token?: string };
          if (message.type !== 'auth' || !message.token) return client.close(1008, 'Authentication required');
          const userId = this.jwt.verify<{ sub?: string }>(message.token).sub;
          if (!userId) return client.close(1008, 'Invalid token');
          clearTimeout(client.authTimer);
          client.userId = userId;
          const set = this.clients.get(userId) ?? new Set<Client>();
          set.add(client); this.clients.set(userId, set);
          await this.sendStatuses(client, userId);
        } catch { client.close(1008, 'Invalid token'); }
      });
    } catch { client.close(1008, 'Invalid token'); }
  }

  handleDisconnect(client: Client) {
    clearTimeout(client.authTimer);
    if (!client.userId) return;
    const set = this.clients.get(client.userId);
    set?.delete(client);
    if (set && set.size === 0) this.clients.delete(client.userId);
  }

  private async broadcast() {
    for (const [userId, clients] of this.clients) {
      try { const statuses = await this.enterprise.getEmployeeStatuses(userId); const payload = JSON.stringify({ type: 'status_update', data: statuses, timestamp: Date.now() });
        for (const client of clients) if (client.readyState === WebSocket.OPEN) client.send(payload);
      } catch (error) { this.logger.debug(`status broadcast failed: ${(error as Error).message}`); }
    }
  }

  private async sendStatuses(client: Client, userId: string) {
    const statuses = await this.enterprise.getEmployeeStatuses(userId);
    if (client.readyState === WebSocket.OPEN) client.send(JSON.stringify({ type: 'status_update', data: statuses, timestamp: Date.now() }));
  }
}
