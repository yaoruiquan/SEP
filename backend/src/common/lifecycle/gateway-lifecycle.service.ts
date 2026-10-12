import { Injectable, OnModuleInit, ServiceUnavailableException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { randomUUID } from 'node:crypto';
import * as fs from 'node:fs';

export const GATEWAY_RUNTIME_DIRECTORY = '/tmp/sep-runtime';
export const GATEWAY_DRAIN_FILE = `${GATEWAY_RUNTIME_DIRECTORY}/gateway-drain.json`;

function positiveInteger(config: ConfigService, name: string, fallback: number): number {
  const configured = config.get<string | number>(name);
  const raw = configured === '' || configured === undefined || configured === null ? fallback : configured;
  const value = typeof raw === 'number' || /^\d+$/.test(raw) ? Number(raw) : NaN;
  if (!Number.isSafeInteger(value) || value <= 0 || value > 2147483647) {
    throw new ServiceUnavailableException(`${name} must be an integer between 1 and 2147483647`);
  }
  return value;
}

@Injectable()
export class GatewayLifecycleService implements OnModuleInit {
  readonly bootId = randomUUID();
  readonly requestBudgetMs: number;
  readonly drainGraceMs: number;
  readonly drainTimeoutMs: number;
  private activeRequests = 0;
  private stopping = false;
  private readonly idleWaiters = new Set<() => void>();

  constructor(config: ConfigService) {
    this.requestBudgetMs = Math.max(
      positiveInteger(config, 'GATEWAY_STREAM_TOTAL_TIMEOUT_MS', 600000),
      positiveInteger(config, 'GATEWAY_NON_STREAM_TIMEOUT_MS', 120000),
    );
    this.drainGraceMs = positiveInteger(config, 'SEP_GATEWAY_DRAIN_GRACE_MS', 30000);
    this.drainTimeoutMs = positiveInteger(
      config, 'SEP_GATEWAY_DRAIN_TIMEOUT_MS', this.requestBudgetMs + this.drainGraceMs,
    );
    if (this.drainTimeoutMs < this.requestBudgetMs + this.drainGraceMs) {
      throw new ServiceUnavailableException('SEP_GATEWAY_DRAIN_TIMEOUT_MS must cover request budget plus grace');
    }
  }

  onModuleInit() {
    fs.mkdirSync(GATEWAY_RUNTIME_DIRECTORY, { recursive: true, mode: 0o700 });
    const directory = fs.lstatSync(GATEWAY_RUNTIME_DIRECTORY);
    if (!directory.isDirectory() || directory.isSymbolicLink()) {
      throw new ServiceUnavailableException('Gateway runtime directory is unsafe');
    }
    fs.chmodSync(GATEWAY_RUNTIME_DIRECTORY, 0o700);
  }

  snapshot() {
    let marked = false;
    let controlError = false;
    try {
      const marker = JSON.parse(fs.readFileSync(GATEWAY_DRAIN_FILE, 'utf8'));
      if (!marker || typeof marker.bootId !== 'string' || typeof marker.token !== 'string' || !marker.token) {
        controlError = true;
      } else {
        marked = marker.bootId === this.bootId;
      }
    } catch (error) {
      controlError = (error as NodeJS.ErrnoException).code !== 'ENOENT';
    }
    return {
      bootId: this.bootId,
      gatewayState: this.stopping ? 'stopping' : controlError ? 'control_error' : marked ? 'draining' : 'ready',
      draining: this.stopping || marked || controlError,
      activeGatewayRequests: this.activeRequests,
      requestBudgetMs: this.requestBudgetMs,
      drainGraceMs: this.drainGraceMs,
      drainTimeoutMs: this.drainTimeoutMs,
    };
  }

  beginRequest(): () => void {
    if (this.snapshot().draining) {
      throw new ServiceUnavailableException({
        error: {
          message: 'Gateway instance is draining', type: 'server_error',
          code: 'SERVER_DRAINING', param: null, source: 'platform',
        },
      });
    }
    this.activeRequests++;
    let released = false;
    return () => {
      if (released) return;
      released = true;
      this.activeRequests--;
      if (this.activeRequests === 0) {
        for (const notify of [...this.idleWaiters]) notify();
      }
    };
  }

  beginShutdown() {
    this.stopping = true;
  }

  waitForIdle(timeoutMs = this.drainTimeoutMs): Promise<boolean> {
    if (this.activeRequests === 0) return Promise.resolve(true);
    return new Promise((resolve) => {
      const finish = (idle: boolean) => {
        clearTimeout(timer);
        this.idleWaiters.delete(onIdle);
        resolve(idle);
      };
      const onIdle = () => finish(true);
      const timer = setTimeout(() => finish(false), timeoutMs);
      this.idleWaiters.add(onIdle);
    });
  }
}
