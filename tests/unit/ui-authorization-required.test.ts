import fs from 'fs';
import path from 'path';
import vm from 'vm';
import ts from 'typescript';

it('shows a retryable connection state and retries with fresh GHL context', async () => {
  const source = fs.readFileSync(path.resolve(__dirname, '../../src/ui/src/composables/useApi.ts'), 'utf8')
    .replace(/import\.meta\.env/g, '({})');
  const compiled = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
  }).outputText;
  let messageHandler: ((event: any) => Promise<void>) | undefined;
  const parent = { postMessage: jest.fn() };
  const fetchMock = jest.fn().mockResolvedValueOnce({
    ok: false, status: 409, json: async () => ({
      error: 'AUTHORIZATION_REQUIRED', message: 'Connection not complete. Do not uninstall.',
    }),
  }).mockResolvedValueOnce({
    ok: true, status: 200, json: async () => ({
      locationId: 'fictional-location', companyId: 'fictional-company', userId: 'fictional-user',
    }),
  });
  const moduleExports: Record<string, any> = {};
  const sessionStorage = { setItem: jest.fn(), removeItem: jest.fn(), getItem: jest.fn() };
  const sandbox = {
    exports: moduleExports,
    require: (name: string) => name === 'vue'
      ? { reactive: (value: any) => value, ref: (value: any) => ({ value }) }
      : { toast: {} },
    window: {
      self: {}, top: {}, parent,
      setTimeout: jest.fn(() => 1), clearTimeout: jest.fn(),
      addEventListener: (_: string, handler: typeof messageHandler) => { messageHandler = handler; },
      removeEventListener: jest.fn(),
    },
    document: { referrer: 'https://app.gohighlevel.com/' },
    fetch: fetchMock, sessionStorage, URL, URLSearchParams, AbortController,
  };
  vm.runInNewContext(compiled, sandbox);
  const first = moduleExports.initSso();
  await messageHandler!({
    source: parent, origin: 'https://app.gohighlevel.com',
    data: { message: 'REQUEST_USER_DATA_RESPONSE', payload: 'fictional-first-payload' },
  });
  await first;
  expect(moduleExports.ssoSession).toMatchObject({
    ready: true, locationId: '', errorCode: 'authorization_required',
  });
  expect(fetchMock).toHaveBeenCalledTimes(1);
  const retry = moduleExports.retrySso();
  expect(parent.postMessage).toHaveBeenCalledTimes(2);
  await messageHandler!({
    source: parent, origin: 'https://app.gohighlevel.com',
    data: { message: 'REQUEST_USER_DATA_RESPONSE', payload: 'fictional-new-payload' },
  });
  await retry;
  expect(moduleExports.ssoSession).toMatchObject({
    ready: true, locationId: 'fictional-location', errorCode: null,
  });
  expect(JSON.parse(fetchMock.mock.calls[1][1].body).payload).toBe('fictional-new-payload');
});
