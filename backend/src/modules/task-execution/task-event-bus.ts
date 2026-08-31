import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import Redis from 'ioredis';
import { Observable, Subject, filter, map } from 'rxjs';
import { hostname } from 'node:os';
import { randomUUID } from 'node:crypto';
import type { TaskStreamFrame } from 'shared';
import { resolveRedisOptions } from '../../redis/redis-connection';

const CHANNEL_PREFIX = 'task-stream:';

interface Envelope {
  /** 发布者实例标识，用来丢掉自己的 Redis 回声（本地已经派发过一次） */
  origin: string;
  taskRunId: string;
  frame: TaskStreamFrame;
}

/**
 * 任务执行事件总线。
 *
 * 为什么要过 Redis：执行 worker 与响应 SSE 的 HTTP 进程不保证是同一个实例
 * （生产是蓝绿双实例，见 deploy/production/docker-compose.blue-green.yml）。
 * 只用进程内 EventEmitter 的话，用户连到 A 实例、worker 跑在 B 实例，页面就
 * 一动不动 —— 而且这种问题在单实例的开发机上永远复现不出来。
 *
 * 本地 Subject 与 Redis 同时发：本地保证 Redis 抖动时同实例仍然实时，
 * Redis 负责跨实例。靠 origin 去重，避免同一帧被派发两次。
 */
@Injectable()
export class TaskEventBus implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(TaskEventBus.name);
  private readonly origin = `${hostname()}:${process.pid}:${randomUUID().slice(0, 8)}`;
  private readonly local$ = new Subject<Envelope>();

  private publisher?: Redis;
  private subscriber?: Redis;
  private redisReady = false;

  constructor(private readonly config: ConfigService) {}

  onModuleInit() {
    const options = { ...resolveRedisOptions(this.config), lazyConnect: true };

    this.publisher = new Redis(options);
    this.subscriber = new Redis(options);

    // Redis 不可用不能让任务执行本身失败 —— 降级为「仅同实例实时」。
    for (const [name, client] of [
      ['publisher', this.publisher],
      ['subscriber', this.subscriber],
    ] as const) {
      client.on('error', (error) => {
        if (this.redisReady) {
          this.logger.warn(`Task event bus ${name} error: ${error.message}`);
        }
        this.redisReady = false;
      });
    }

    this.subscriber.on('pmessage', (_pattern, channel: string, payload: string) => {
      try {
        const envelope = JSON.parse(payload) as Envelope;
        if (envelope.origin === this.origin) return; // 自己的回声
        envelope.taskRunId = channel.slice(CHANNEL_PREFIX.length);
        this.local$.next(envelope);
      } catch (error) {
        this.logger.warn(`Dropped malformed task frame on ${channel}: ${(error as Error).message}`);
      }
    });

    void Promise.all([this.publisher.connect(), this.subscriber.connect()])
      .then(() => this.subscriber?.psubscribe(`${CHANNEL_PREFIX}*`))
      .then(() => {
        this.redisReady = true;
        this.logger.log('Task event bus connected (cross-instance streaming enabled)');
      })
      .catch((error: Error) => {
        this.logger.warn(
          `Task event bus running in single-instance mode (Redis unavailable: ${error.message})`,
        );
      });
  }

  async onModuleDestroy() {
    this.local$.complete();
    await Promise.allSettled([this.publisher?.quit(), this.subscriber?.quit()]);
  }

  publish(taskRunId: string, frame: TaskStreamFrame): void {
    const envelope: Envelope = { origin: this.origin, taskRunId, frame };
    this.local$.next(envelope);

    if (this.redisReady && this.publisher) {
      this.publisher
        .publish(`${CHANNEL_PREFIX}${taskRunId}`, JSON.stringify(envelope))
        .catch((error: Error) => this.logger.warn(`Publish failed: ${error.message}`));
    }
  }

  /** 订阅某个运行的帧流。调用方负责在连接关闭时取消订阅。 */
  frames(taskRunId: string): Observable<TaskStreamFrame> {
    return this.local$.pipe(
      filter((envelope) => envelope.taskRunId === taskRunId),
      map((envelope) => envelope.frame),
    );
  }
}
