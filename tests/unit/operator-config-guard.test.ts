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

  it('rejects health incidents without the isolated command center', () => {
    jest.resetModules();
    process.env.OPERATOR_COMMAND_CENTER_ENABLED = 'false';
    process.env.OPERATOR_AUTH_ENABLED = 'false';
    process.env.OPERATOR_HEALTH_INCIDENTS_ENABLED = 'true';
    const exit = jest.spyOn(process, 'exit').mockImplementation(((code?: number) => {
      throw new Error(`EXIT_${code}`);
    }) as never);

    expect(() => require('../../src/config')).toThrow('EXIT_1');
    expect(exit).toHaveBeenCalledWith(1);
  });

  it('keeps health incidents disabled by default', () => {
    jest.resetModules();
    process.env.OPERATOR_COMMAND_CENTER_ENABLED = 'true';
    process.env.OPERATOR_AUTH_ENABLED = 'false';
    delete process.env.OPERATOR_HEALTH_INCIDENTS_ENABLED;
    const loaded = require('../../src/config');

    expect(loaded.config.operator.healthEnabled).toBe(false);
  });
});
