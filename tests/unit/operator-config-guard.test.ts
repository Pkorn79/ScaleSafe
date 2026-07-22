const originalEnvironment = { ...process.env };

function loadConfigWith(operatorKey: string, processorKey: string): void {
  jest.resetModules();
  process.env.OPERATOR_COMMAND_CENTER_ENABLED = 'true';
  process.env.OPERATOR_AUTH_ENABLED = 'true';
  process.env.OPERATOR_HOST = 'ops.scalesafe.app';
  process.env.OPERATOR_AUTH_TOKEN_ENCRYPTION_KEY = operatorKey;
  process.env.PROCESSOR_ENCRYPTION_KEY = processorKey;
  require('../../src/config');
}

describe('operator configuration startup guard', () => {
  afterEach(() => {
    process.env = { ...originalEnvironment };
    jest.restoreAllMocks();
    jest.resetModules();
  });

  it('rejects an invalid operator credential-encryption key', () => {
    const exit = jest.spyOn(process, 'exit').mockImplementation(((code?: number) => {
      throw new Error(`EXIT_${code}`);
    }) as never);

    expect(() => loadConfigWith('not-a-32-byte-key', '1'.repeat(64))).toThrow('EXIT_1');
    expect(exit).toHaveBeenCalledWith(1);
  });

  it('rejects reuse of the processor encryption key', () => {
    const sharedKey = 'a'.repeat(64);
    const exit = jest.spyOn(process, 'exit').mockImplementation(((code?: number) => {
      throw new Error(`EXIT_${code}`);
    }) as never);

    expect(() => loadConfigWith(sharedKey, sharedKey)).toThrow('EXIT_1');
    expect(exit).toHaveBeenCalledWith(1);
  });

  it('accepts distinct 32-byte operator and processor keys', () => {
    const exit = jest.spyOn(process, 'exit').mockImplementation(((code?: number) => {
      throw new Error(`EXIT_${code}`);
    }) as never);

    expect(() => loadConfigWith('a'.repeat(64), 'b'.repeat(64))).not.toThrow();
    expect(exit).not.toHaveBeenCalled();
  });
});
