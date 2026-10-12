import { waitForGatewayOperation } from './gateway-operation';

describe('Bounded gateway state operations', () => {
  beforeEach(() => jest.useFakeTimers());
  afterEach(() => jest.useRealTimers());

  it('clears the wait timer after a successful operation', async () => {
    expect(await waitForGatewayOperation(Promise.resolve('saved'))).toBe('saved');
    expect(jest.getTimerCount()).toBe(0);
  });

  it('times out in five seconds and observes a late rejection', async () => {
    let reject!: (reason: unknown) => void;
    const pending = new Promise<void>((_resolve, fail) => { reject = fail; });
    const outcome = waitForGatewayOperation(pending).catch(error => error);
    await jest.advanceTimersByTimeAsync(5000);
    expect(await outcome).toMatchObject({ response: { error: { code: 'EXECUTION_JOURNAL_TIMEOUT', source: 'platform' } } });
    reject(new Error('late failure'));
    await jest.advanceTimersByTimeAsync(0);
    expect(jest.getTimerCount()).toBe(0);
  });

  it('returns a phase-specific timeout code', async () => {
    const outcome = waitForGatewayOperation(new Promise<void>(() => undefined), 'PLATFORM_ADMISSION_TIMEOUT').catch(error => error);
    await jest.advanceTimersByTimeAsync(5000);
    expect(await outcome).toMatchObject({ response: { error: { code: 'PLATFORM_ADMISSION_TIMEOUT' } } });
  });
});
