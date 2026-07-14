import { createFetchWithTimeout } from '../../src/clients/supabase.client';

test('Supabase fetch wrapper aborts a stalled request at the configured deadline', async () => {
  const stalledFetch = jest.fn((_input: any, init?: RequestInit) => new Promise<Response>((_resolve, reject) => {
    init?.signal?.addEventListener('abort', () => reject(new Error('aborted')), { once: true });
  })) as unknown as typeof fetch;
  const boundedFetch = createFetchWithTimeout(stalledFetch, 10);

  await expect(boundedFetch('https://example.test')).rejects.toMatchObject({
    name: 'SupabaseRequestTimeoutError',
    message: 'Supabase request exceeded 10ms',
  });
});

test('Supabase fetch wrapper preserves successful responses', async () => {
  const response = new Response('{}', { status: 200 });
  const fetchImpl = jest.fn().mockResolvedValue(response) as unknown as typeof fetch;

  await expect(createFetchWithTimeout(fetchImpl, 100)('https://example.test')).resolves.toBe(response);
});
