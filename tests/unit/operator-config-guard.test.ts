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

  it('keeps Guardian ingestion disabled by default', () => {
    jest.resetModules();
    delete process.env.GUARDIAN_INGESTION_ENABLED;
    const loaded = require('../../src/config');

    expect(loaded.config.guardian.enabled).toBe(false);
  });

  it('keeps the platform listener behavior unchanged by default', () => {
    jest.resetModules();
    delete process.env.SERVER_BIND_HOST;
    const loaded = require('../../src/config');

    expect(loaded.config.bindHost).toBeNull();
  });

  it('requires an explicit proxy depth in production', () => {
    jest.resetModules();
    process.env.NODE_ENV = 'production';
    delete process.env.APP_TRUST_PROXY_HOPS;
    delete process.env.OPERATOR_TRUST_PROXY_HOPS;
    const exit = jest.spyOn(process, 'exit').mockImplementation(((code?: number) => {
      throw new Error(`EXIT_${code}`);
    }) as never);

    expect(() => require('../../src/config')).toThrow('EXIT_1');
    expect(exit).toHaveBeenCalledWith(1);
  });

  it('accepts explicit loopback binding and rejects arbitrary hostnames', () => {
    jest.resetModules();
    process.env.SERVER_BIND_HOST = '127.0.0.1';
    expect(require('../../src/config').config.bindHost).toBe('127.0.0.1');

    jest.resetModules();
    process.env.SERVER_BIND_HOST = 'phase35.example.com';
    const exit = jest.spyOn(process, 'exit').mockImplementation(((code?: number) => {
      throw new Error(`EXIT_${code}`);
    }) as never);
    expect(() => require('../../src/config')).toThrow('EXIT_1');
    expect(exit).toHaveBeenCalledWith(1);
  });

  it('rejects Guardian without the complete Phase 2 command center', () => {
    jest.resetModules();
    process.env.GUARDIAN_INGESTION_ENABLED = 'true';
    process.env.OPERATOR_COMMAND_CENTER_ENABLED = 'true';
    process.env.OPERATOR_AUTH_ENABLED = 'false';
    process.env.OPERATOR_HEALTH_INCIDENTS_ENABLED = 'true';
    const exit = jest.spyOn(process, 'exit').mockImplementation(((code?: number) => {
      throw new Error(`EXIT_${code}`);
    }) as never);

    expect(() => require('../../src/config')).toThrow('EXIT_1');
    expect(exit).toHaveBeenCalledWith(1);
  });

  it('rejects a Guardian host that shares the operator identity plane', () => {
    jest.resetModules();
    process.env.GUARDIAN_INGESTION_ENABLED = 'true';
    process.env.OPERATOR_COMMAND_CENTER_ENABLED = 'true';
    process.env.OPERATOR_AUTH_ENABLED = 'true';
    process.env.OPERATOR_HEALTH_INCIDENTS_ENABLED = 'true';
    process.env.OPERATOR_HOST = 'ops.scalesafe.app';
    process.env.GUARDIAN_HOST = 'ops.scalesafe.app';
    const exit = jest.spyOn(process, 'exit').mockImplementation(((code?: number) => {
      throw new Error(`EXIT_${code}`);
    }) as never);

    expect(() => require('../../src/config')).toThrow('EXIT_1');
    expect(exit).toHaveBeenCalledWith(1);
  });

  it('accepts the frozen Guardian v1 limits on a dedicated host', () => {
    jest.resetModules();
    process.env.GUARDIAN_INGESTION_ENABLED = 'true';
    process.env.OPERATOR_COMMAND_CENTER_ENABLED = 'true';
    process.env.OPERATOR_AUTH_ENABLED = 'true';
    process.env.OPERATOR_HEALTH_INCIDENTS_ENABLED = 'true';
    process.env.OPERATOR_HOST = 'ops.scalesafe.app';
    process.env.GUARDIAN_HOST = 'guardian.scalesafe.app';
    process.env.GUARDIAN_MAX_BODY_BYTES = '65536';
    process.env.GUARDIAN_TIMESTAMP_TOLERANCE_SECONDS = '300';
    const exit = jest.spyOn(process, 'exit').mockImplementation(((code?: number) => {
      throw new Error(`EXIT_${code}`);
    }) as never);

    const loaded = require('../../src/config');
    expect(loaded.config.guardian.enabled).toBe(true);
    expect(loaded.config.guardian.host).toBe('guardian.scalesafe.app');
    expect(exit).not.toHaveBeenCalled();
  });
});
