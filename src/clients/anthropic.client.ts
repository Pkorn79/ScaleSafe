import axios from 'axios';
import { config } from '../config';
import { logger } from '../utils/logger';
import { ExternalServiceError } from '../utils/errors';

const API_URL = 'https://api.anthropic.com/v1/messages';

// Active model. The previous default (claude-sonnet-4-20250514) is retired, which
// silently dropped every defense letter into the deterministic fallback. Overridable
// via ANTHROPIC_MODEL so the model can be moved without a deploy.
const MODEL = process.env.ANTHROPIC_MODEL || 'claude-sonnet-5';

// Transient failures worth retrying: rate limit, gateway/overload, and Anthropic 5xx.
const RETRYABLE_STATUS = new Set([429, 500, 502, 503, 504, 529]);
const MAX_ATTEMPTS = 3;
const BASE_BACKOFF_MS = 500;

interface ClaudeResponse {
  text: string;
  inputTokens: number;
  outputTokens: number;
}

function isRetryableError(err: any): boolean {
  // Network-level failure (timeout, reset, no response received)
  if (!err?.response) {
    const code = err?.code;
    return (
      code === 'ECONNABORTED' ||
      code === 'ETIMEDOUT' ||
      code === 'ECONNRESET' ||
      code === 'EAI_AGAIN' ||
      err?.message?.toLowerCase?.().includes('timeout') === true
    );
  }
  return RETRYABLE_STATUS.has(err.response.status);
}

function backoffMs(attempt: number): number {
  // Tests run with NODE_ENV=test — no real delay so the suite stays fast.
  if (process.env.NODE_ENV === 'test') return 0;
  const expo = BASE_BACKOFF_MS * 2 ** attempt; // 500, 1000, 2000…
  const jitter = Math.floor(Math.random() * BASE_BACKOFF_MS);
  return expo + jitter;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Call Claude API to generate text.
 * Used for defense letter generation and evidence analysis.
 *
 * Retries transient failures (429/5xx/network timeouts) with exponential backoff
 * + jitter, up to MAX_ATTEMPTS. Non-retryable errors (400/401/404, etc.) throw
 * immediately so the caller falls back without burning retries.
 */
export async function callClaude(
  systemPrompt: string,
  userMessage: string,
  maxTokens: number = 4096,
): Promise<ClaudeResponse> {
  if (!config.anthropicApiKey) {
    throw new ExternalServiceError('Anthropic', 'API key not configured');
  }

  let lastErr: any;
  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
    try {
      const res = await axios.post(API_URL, {
        model: MODEL,
        max_tokens: maxTokens,
        system: systemPrompt,
        messages: [{ role: 'user', content: userMessage }],
      }, {
        headers: {
          'x-api-key': config.anthropicApiKey,
          'anthropic-version': '2023-06-01',
          'Content-Type': 'application/json',
        },
        timeout: 120000, // 2 minutes for long defense letters
      });

      const content = res.data.content?.[0];
      if (!content || content.type !== 'text') {
        throw new ExternalServiceError('Anthropic', 'Unexpected response format');
      }

      return {
        text: content.text,
        inputTokens: res.data.usage?.input_tokens || 0,
        outputTokens: res.data.usage?.output_tokens || 0,
      };
    } catch (err: any) {
      lastErr = err;
      const retryable = isRetryableError(err);
      const isLastAttempt = attempt === MAX_ATTEMPTS - 1;
      if (!retryable || isLastAttempt) {
        throw err;
      }
      const delay = backoffMs(attempt);
      logger.warn(
        { attempt: attempt + 1, maxAttempts: MAX_ATTEMPTS, status: err?.response?.status, delay },
        'Anthropic call failed with transient error; retrying',
      );
      await sleep(delay);
    }
  }

  // Unreachable — the loop either returns or throws — but satisfies the type checker.
  throw lastErr;
}
