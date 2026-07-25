jest.mock('../../src/config', () => ({
  config: {
    operator: { healthEnabled: true },
  },
}));

const writeApplicationMetricBucket = jest.fn().mockResolvedValue(undefined);

jest.mock('../../src/repositories/command-center-health.repository', () => ({
  setCommandCenterRequestObserver: jest.fn(),
  commandCenterHealthRepository: {
    writeApplicationMetricBucket: (...args: unknown[]) => writeApplicationMetricBucket(...args),
  },
}));

jest.mock('../../src/utils/logger', () => ({
  logger: {
    warn: jest.fn(),
  },
}));

import {
  applicationMetricsService,
  normalizeMetricRouteGroup,
} from '../../src/services/application-metrics.service';

afterEach(() => {
  applicationMetricsService.stop();
  jest.useRealTimers();
  writeApplicationMetricBucket.mockReset();
  writeApplicationMetricBucket.mockResolvedValue(undefined);
});

describe('application metrics route grouping', () => {
  it('drops query strings and limits route cardinality to three segments', () => {
    expect(normalizeMetricRouteGroup('/api/offers/active/details?token=secret')).toBe(
      '/api/offers/active',
    );
  });

  it.each([
    ['/api/clients/39f8b927-ec21-4ea7-a8e8-1ee0b06a2f69', '/api/clients/:id'],
    ['/api/clients/N7kNRLU1wGXuUfqjrBPuE', '/api/clients/:id'],
    ['/api/clients/phil%40example.com', '/api/clients/:id'],
    ['/api/payments/123456', '/api/payments/:id'],
    ['/api/files/0123456789abcdef', '/api/files/:id'],
    ['/api/files/%E0%A4%A', '/api/files/:id'],
  ])('redacts dynamic or identifying route segment %s', (input, expected) => {
    expect(normalizeMetricRouteGroup(input)).toBe(expected);
  });

  it('preserves low-cardinality route names', () => {
    expect(normalizeMetricRouteGroup('/internal/operator/api/health')).toBe(
      '/internal/operator/api',
    );
    expect(normalizeMetricRouteGroup('/webhooks/stripe')).toBe('/webhooks/stripe');
  });

  it('flushes each UTC five-minute bucket once without replacing earlier counts', async () => {
    jest.useFakeTimers();
    jest.setSystemTime(new Date('2026-07-23T12:00:30.000Z'));
    applicationMetricsService.__resetForTests(new Date());

    applicationMetricsService.recordRequest('/health', 200, 10);
    jest.setSystemTime(new Date('2026-07-23T12:05:00.000Z'));
    applicationMetricsService.recordRequest('/health', 200, 20);
    await applicationMetricsService.flushNow();

    expect(writeApplicationMetricBucket).toHaveBeenCalledTimes(1);
    expect(writeApplicationMetricBucket).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        bucketStartedAt: '2026-07-23T12:00:00.000Z',
        bucketEndedAt: '2026-07-23T12:05:00.000Z',
        requestCount: 1,
      }),
    );

    jest.setSystemTime(new Date('2026-07-23T12:10:00.000Z'));
    applicationMetricsService.recordRequest('/health', 200, 30);
    await applicationMetricsService.flushNow();

    expect(writeApplicationMetricBucket).toHaveBeenCalledTimes(2);
    expect(writeApplicationMetricBucket).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        bucketStartedAt: '2026-07-23T12:05:00.000Z',
        bucketEndedAt: '2026-07-23T12:10:00.000Z',
        requestCount: 1,
      }),
    );
  });
});
