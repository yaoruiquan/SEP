import { GatewayTimeoutException, HttpException } from '@nestjs/common';

/** One deadline per business request, shared by preparation and every model step. */
export class ModelRequestLifecycle {
  private readonly controller = new AbortController();
  private readonly timer: ReturnType<typeof setTimeout>;
  private readonly onCancel = () => this.abort(new HttpException({ code: 'MODEL_REQUEST_CANCELLED', message: '模型请求已取消' }, 499));
  readonly signal = this.controller.signal;

  constructor(timeoutMs: number, private readonly externalSignal?: AbortSignal, phase = 'total') {
    this.timer = setTimeout(() => this.abort(new GatewayTimeoutException({
      code: 'MODEL_REQUEST_TIMEOUT', source: 'platform', phase, message: `模型请求超过${phase === 'planner' ? '任务规划' : '总时长'}预算`,
    })), timeoutMs);
    this.timer.unref?.();
    externalSignal?.addEventListener('abort', this.onCancel, { once: true });
    if (externalSignal?.aborted) this.onCancel();
  }

  abort(reason: unknown): void {
    if (!this.signal.aborted) this.controller.abort(reason);
  }

  assertActive(): void {
    this.signal.throwIfAborted();
  }

  async wait<T>(operation: PromiseLike<T>, extraSignal?: AbortSignal): Promise<T> {
    // The caller may already have started the operation before cancellation was observed.
    const pending = Promise.resolve(operation);
    void pending.catch(() => undefined);
    this.assertActive();
    extraSignal?.throwIfAborted();
    let rejectAbort: (() => void) | undefined;
    let rejectExtra: (() => void) | undefined;
    const aborted = new Promise<never>((_, reject) => {
      rejectAbort = () => reject(this.signal.reason);
      this.signal.addEventListener('abort', rejectAbort, { once: true });
      if (extraSignal) {
        rejectExtra = () => reject(extraSignal.reason);
        extraSignal.addEventListener('abort', rejectExtra, { once: true });
      }
    });
    try {
      return await Promise.race([pending, aborted]);
    } finally {
      if (rejectAbort) this.signal.removeEventListener('abort', rejectAbort);
      if (rejectExtra) extraSignal?.removeEventListener('abort', rejectExtra);
    }
  }

  dispose(): void {
    clearTimeout(this.timer);
    this.externalSignal?.removeEventListener('abort', this.onCancel);
  }
}
