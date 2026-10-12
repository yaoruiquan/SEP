import { ModelRequestLifecycle } from './model-request-lifecycle';

describe('ModelRequestLifecycle', () => {
  beforeEach(() => jest.useFakeTimers());
  afterEach(() => jest.useRealTimers());

  it('uses one deadline across preparation and successive model steps', async () => {
    const lifecycle = new ModelRequestLifecycle(1000);
    await jest.advanceTimersByTimeAsync(600);
    await expect(lifecycle.wait(Promise.resolve('first'))).resolves.toBe('first');
    const pending = expect(lifecycle.wait(new Promise(() => undefined))).rejects.toMatchObject({ status: 504 });
    await jest.advanceTimersByTimeAsync(401);
    await pending;
    expect(lifecycle.signal.aborted).toBe(true);
    lifecycle.dispose();
  });

  it('propagates cancellation and cleans up timeout and listeners', async () => {
    const abort = new AbortController();
    const lifecycle = new ModelRequestLifecycle(1000, abort.signal);
    const pending = expect(lifecycle.wait(new Promise(() => undefined))).rejects.toMatchObject({ status: 499 });
    abort.abort();
    await pending;
    lifecycle.dispose();
    expect(jest.getTimerCount()).toBe(0);
  });

  it('fails already-cancelled requests before executing additional steps', () => {
    const lifecycle = new ModelRequestLifecycle(1000, AbortSignal.abort());
    expect(() => lifecycle.assertActive()).toThrow();
    lifecycle.dispose();
  });

  it('observes a started operation rejection even if cancellation happened first', async () => {
    const lifecycle = new ModelRequestLifecycle(1000, AbortSignal.abort());
    await expect(lifecycle.wait(Promise.reject(new Error('late failure')))).rejects.toMatchObject({ status: 499 });
    lifecycle.dispose();
  });
});
