/**
 * Anthropic client retry tests.
 * The retired model + no-retry behavior silently dropped every transient failure
 * into the deterministic fallback letter. callClaude must now retry transient
 * failures (429/5xx/network) and only throw after exhausting attempts.
 */

jest.mock('axios');
jest.mock('../../src/config', () => ({
  config: { anthropicApiKey: 'test-key', logLevel: 'silent' },
}));

import axios from 'axios';
import { callClaude } from '../../src/clients/anthropic.client';

const mockedPost = axios.post as jest.Mock;

function okResponse(text = 'letter text') {
  return {
    data: {
      content: [{ type: 'text', text }],
      usage: { input_tokens: 10, output_tokens: 20 },
    },
  };
}

function httpError(status: number) {
  return { response: { status }, message: `HTTP ${status}` };
}

beforeEach(() => {
  jest.clearAllMocks();
  process.env.NODE_ENV = 'test'; // backoff is 0ms under test
});

describe('callClaude retry behavior', () => {
  test('retries after a transient 529 and then succeeds', async () => {
    mockedPost
      .mockRejectedValueOnce(httpError(529))
      .mockResolvedValueOnce(okResponse('recovered'));

    const result = await callClaude('sys', 'user');

    expect(mockedPost).toHaveBeenCalledTimes(2);
    expect(result.text).toBe('recovered');
    expect(result.inputTokens).toBe(10);
    expect(result.outputTokens).toBe(20);
  });

  test('retries transient network timeouts (no response)', async () => {
    mockedPost
      .mockRejectedValueOnce({ code: 'ETIMEDOUT', message: 'timeout of 120000ms exceeded' })
      .mockResolvedValueOnce(okResponse('after-timeout'));

    const result = await callClaude('sys', 'user');

    expect(mockedPost).toHaveBeenCalledTimes(2);
    expect(result.text).toBe('after-timeout');
  });

  test('gives up after MAX_ATTEMPTS on persistent transient failure', async () => {
    mockedPost.mockRejectedValue(httpError(503));

    await expect(callClaude('sys', 'user')).rejects.toBeTruthy();
    expect(mockedPost).toHaveBeenCalledTimes(3);
  });

  test('does NOT retry a non-retryable error (401) and throws immediately', async () => {
    mockedPost.mockRejectedValue(httpError(401));

    await expect(callClaude('sys', 'user')).rejects.toBeTruthy();
    expect(mockedPost).toHaveBeenCalledTimes(1);
  });
});
