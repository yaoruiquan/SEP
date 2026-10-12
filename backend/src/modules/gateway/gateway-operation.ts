import { ServiceUnavailableException } from '@nestjs/common';

/** A timeout stops waiting, not the underlying write; race observes late rejections. */
export async function waitForGatewayOperation<T>(
  operation: Promise<T>, code = 'EXECUTION_JOURNAL_TIMEOUT',
): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([operation, new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(new ServiceUnavailableException({ error: {
        code, type: 'server_error', source: 'platform',
        message: '模型执行状态服务超时，请稍后查询执行状态', param: null,
      } })), 5000);
    })]);
  } finally { clearTimeout(timer); }
}
