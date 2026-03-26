import { AppError, ValidationError, AuthenticationError, NotFoundError, GHLApiError, ExternalServiceError } from '../../src/utils/errors';

describe('Error Classes', () => {
  test('AppError has correct defaults', () => {
    const err = new AppError('test');
    expect(err.statusCode).toBe(500);
    expect(err.code).toBe('INTERNAL_ERROR');
    expect(err.message).toBe('test');
    expect(err).toBeInstanceOf(Error);
  });

  test('ValidationError is 400', () => {
    const err = new ValidationError('bad input');
    expect(err.statusCode).toBe(400);
    expect(err.code).toBe('VALIDATION_ERROR');
  });

  test('AuthenticationError is 401', () => {
    const err = new AuthenticationError();
    expect(err.statusCode).toBe(401);
    expect(err.message).toBe('Authentication required');
  });

  test('NotFoundError is 404 with resource name', () => {
    const err = new NotFoundError('Merchant xyz');
    expect(err.statusCode).toBe(404);
    expect(err.message).toBe('Merchant xyz not found');
  });

  test('GHLApiError is 502 with GHL status', () => {
    const err = new GHLApiError('rate limited', 429);
    expect(err.statusCode).toBe(502);
    expect(err.ghlStatus).toBe(429);
  });

  test('ExternalServiceError includes service name', () => {
    const err = new ExternalServiceError('Anthropic', 'timeout');
    expect(err.statusCode).toBe(502);
    expect(err.message).toContain('Anthropic');
  });
});
