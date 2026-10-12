import { INestApplication, Logger } from '@nestjs/common';
import { GatewayLifecycleService } from './gateway-lifecycle.service';

type SignalSource = Pick<NodeJS.Process, 'on' | 'removeListener'>;

/** Wait before app.close(): Nest destroy hooks can disconnect Prisma before HTTP closes. */
export function installGatewayShutdown(
  app: Pick<INestApplication, 'close'>,
  lifecycle: GatewayLifecycleService,
  signals: SignalSource = process,
  logger: Pick<Logger, 'error' | 'log'> = new Logger('GatewayShutdown'),
) {
  let pending = false;
  const shutdown = async () => {
    if (pending) return;
    pending = true;
    lifecycle.beginShutdown();
    try {
      if (!await lifecycle.waitForIdle()) {
        logger.error('Gateway shutdown timed out; process retained in stopping state, no forced termination');
        return;
      }
      await app.close();
      logger.log('Gateway requests drained and application closed');
      cleanup();
    } catch {
      logger.error('Application shutdown failed; no forced termination');
    } finally {
      pending = false;
    }
  };
  const listener = () => { void shutdown(); };
  const cleanup = () => {
    signals.removeListener('SIGTERM', listener);
    signals.removeListener('SIGINT', listener);
  };
  signals.on('SIGTERM', listener);
  signals.on('SIGINT', listener);
  return cleanup;
}
