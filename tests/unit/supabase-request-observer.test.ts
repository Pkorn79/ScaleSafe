import {
  createFetchWithTimeout,
  setSupabaseRequestObserver,
} from '../../src/clients/supabase.client';

describe('Supabase request observer', () => {
  afterEach(() => {
    setSupabaseRequestObserver(null);
    jest.useRealTimers();
  });

  it('counts one completed Supabase fetch', async () => {
    const observer = jest.fn();
    const response = new Response('{}', { status: 200 });
    const fetchImpl = jest.fn().mockResolvedValue(response) as unknown as typeof fetch;
    setSupabaseRequestObserver(observer);

    await expect(createFetchWithTimeout(fetchImpl, 1000)('http://localhost/test'))
      .resolves.toBe(response);

    expect(observer).toHaveBeenCalledWith({ timedOut: false });
  });

  it('counts a timed-out Supabase fetch without replacing its timeout error', async () => {
    jest.useFakeTimers();
    const observer = jest.fn();
    const fetchImpl = jest.fn((_input: unknown, init?: RequestInit) => new Promise((_resolve, reject) => {
      init?.signal?.addEventListener('abort', () => reject(new Error('aborted')), { once: true });
    })) as unknown as typeof fetch;
    setSupabaseRequestObserver(observer);

    const request = createFetchWithTimeout(fetchImpl, 50)('http://localhost/test');
    const rejection = expect(request).rejects.toMatchObject({
      name: 'SupabaseRequestTimeoutError',
    });
    await jest.advanceTimersByTimeAsync(50);

    await rejection;
    expect(observer).toHaveBeenCalledWith({ timedOut: true });
  });
});
