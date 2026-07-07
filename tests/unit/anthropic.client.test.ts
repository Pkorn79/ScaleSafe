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

// claude-sonnet-5+ runs adaptive thinking by default: the response leads with a
// thinking block (empty text unless display is opted in) before the text block.
function thinkingResponse(text = 'letter text') {
  return {
    data: {
      content: [
        { type: 'thinking', thinking: '' },
        { type: 'text', text },
      ],
      usage: { input_tokens: 10, output_tokens: 20 },
      stop_reason: 'end_turn',
    },
  };
}

function httpError(status: number) {
  return { response: { status }, message: `HTTP ${status}` };
}

beforeEach(() => {
  jest.clearAllMocks();
  process.env.NODE_ENV = 'test'; // backoff is 0ms under test
  delete process.env.ANTHROPIC_MODEL_PRIMARY;
  delete process.env.ANTHROPIC_MODEL_FALLBACKS;
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

describe('callClaude response parsing', () => {
  // The live regression: content[0] was a thinking block, the old guard required
  // content[0].type === 'text', so EVERY adaptive-thinking response threw
  // "Unexpected response format" and defense letters fell back.
  test('extracts text when a thinking block precedes it (adaptive thinking default)', async () => {
    mockedPost.mockResolvedValueOnce(thinkingResponse('the letter'));

    const result = await callClaude('sys', 'user');
    expect(result.text).toBe('the letter');
  });

  test('joins multiple text blocks', async () => {
    mockedPost.mockResolvedValueOnce({
      data: {
        content: [
          { type: 'thinking', thinking: '' },
          { type: 'text', text: 'part one ' },
          { type: 'text', text: 'part two' },
        ],
        usage: { input_tokens: 1, output_tokens: 2 },
        stop_reason: 'end_turn',
      },
    });

    const result = await callClaude('sys', 'user');
    expect(result.text).toBe('part one part two');
  });

  test('refusal stop_reason throws immediately and does NOT try fallback models', async () => {
    process.env.ANTHROPIC_MODEL_PRIMARY = 'model-a';
    process.env.ANTHROPIC_MODEL_FALLBACKS = 'model-b';
    mockedPost.mockResolvedValue({
      data: {
        content: [],
        stop_reason: 'refusal',
        stop_details: { type: 'refusal', category: 'cyber' },
        usage: { input_tokens: 5, output_tokens: 0 },
      },
    });

    await expect(callClaude('sys', 'user')).rejects.toThrow(/refused/i);
    expect(mockedPost).toHaveBeenCalledTimes(1);
  });

  test('empty content with no text throws a descriptive error', async () => {
    mockedPost.mockResolvedValue({
      data: { content: [], stop_reason: 'end_turn', usage: {} },
    });

    await expect(callClaude('sys', 'user')).rejects.toThrow(/No text content/);
  });
});

describe('callClaude model fallback', () => {
  // Fallback across models is allowed ONLY for availability/access failures
  // (retired/unknown model → 404, model access → 403) and exhausted transient
  // retries. Product bugs (400 malformed prompt) and key-level auth (401) must
  // throw immediately — trying more models there would hide real bugs.

  test('404 (model retired/unknown) advances to the next configured model', async () => {
    process.env.ANTHROPIC_MODEL_PRIMARY = 'model-a';
    process.env.ANTHROPIC_MODEL_FALLBACKS = 'model-b';
    mockedPost
      .mockRejectedValueOnce(httpError(404))
      .mockResolvedValueOnce(okResponse('from-b'));

    const result = await callClaude('sys', 'user');

    expect(mockedPost).toHaveBeenCalledTimes(2);
    expect(mockedPost.mock.calls[0][1].model).toBe('model-a');
    expect(mockedPost.mock.calls[1][1].model).toBe('model-b');
    expect(result.text).toBe('from-b');
    expect(result.model).toBe('model-b');
    expect(result.modelAttempts).toEqual([
      expect.objectContaining({ model: 'model-a', result: 'failed', status: 404 }),
      expect.objectContaining({ model: 'model-b', result: 'succeeded' }),
    ]);
  });

  test('403 (model access denied) advances to the next configured model', async () => {
    process.env.ANTHROPIC_MODEL_PRIMARY = 'model-a';
    process.env.ANTHROPIC_MODEL_FALLBACKS = 'model-b';
    mockedPost
      .mockRejectedValueOnce(httpError(403))
      .mockResolvedValueOnce(okResponse('from-b'));

    const result = await callClaude('sys', 'user');
    expect(mockedPost).toHaveBeenCalledTimes(2);
    expect(result.model).toBe('model-b');
  });

  test('exhausted transient retries on the primary advance to the fallback model', async () => {
    process.env.ANTHROPIC_MODEL_PRIMARY = 'model-a';
    process.env.ANTHROPIC_MODEL_FALLBACKS = 'model-b';
    mockedPost
      .mockRejectedValueOnce(httpError(529))
      .mockRejectedValueOnce(httpError(529))
      .mockRejectedValueOnce(httpError(529)) // MAX_ATTEMPTS on model-a
      .mockResolvedValueOnce(okResponse('recovered-on-b'));

    const result = await callClaude('sys', 'user');

    expect(mockedPost).toHaveBeenCalledTimes(4);
    expect(mockedPost.mock.calls[3][1].model).toBe('model-b');
    expect(result.model).toBe('model-b');
  });

  test('400 (malformed request / product bug) does NOT fall back to another model', async () => {
    process.env.ANTHROPIC_MODEL_PRIMARY = 'model-a';
    process.env.ANTHROPIC_MODEL_FALLBACKS = 'model-b,model-c';
    mockedPost.mockRejectedValue(httpError(400));

    await expect(callClaude('sys', 'user')).rejects.toBeTruthy();
    expect(mockedPost).toHaveBeenCalledTimes(1);
  });

  test('401 (key-level auth) does NOT fall back to another model', async () => {
    process.env.ANTHROPIC_MODEL_PRIMARY = 'model-a';
    process.env.ANTHROPIC_MODEL_FALLBACKS = 'model-b';
    mockedPost.mockRejectedValue(httpError(401));

    await expect(callClaude('sys', 'user')).rejects.toBeTruthy();
    expect(mockedPost).toHaveBeenCalledTimes(1);
  });

  test('all configured models failing throws with modelAttempts attached', async () => {
    process.env.ANTHROPIC_MODEL_PRIMARY = 'model-a';
    process.env.ANTHROPIC_MODEL_FALLBACKS = 'model-b';
    mockedPost.mockRejectedValue(httpError(404));

    let thrown: any;
    try {
      await callClaude('sys', 'user');
    } catch (err) {
      thrown = err;
    }
    expect(thrown).toBeTruthy();
    expect(mockedPost).toHaveBeenCalledTimes(2);
    expect(thrown.modelAttempts).toEqual([
      expect.objectContaining({ model: 'model-a', result: 'failed', status: 404 }),
      expect.objectContaining({ model: 'model-b', result: 'failed', status: 404 }),
    ]);
  });

  test('no fallbacks configured behaves like before (single model, immediate throw on 404)', async () => {
    mockedPost.mockRejectedValue(httpError(404));

    await expect(callClaude('sys', 'user')).rejects.toBeTruthy();
    expect(mockedPost).toHaveBeenCalledTimes(1);
  });
});
