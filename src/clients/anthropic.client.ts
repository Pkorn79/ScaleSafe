import axios from 'axios';
import { config } from '../config';
import { logger } from '../utils/logger';
import { ExternalServiceError } from '../utils/errors';

const API_URL = 'https://api.anthropic.com/v1/messages';

// Transient failures worth retrying on the SAME model: rate limit, gateway/overload,
// and Anthropic 5xx.
const RETRYABLE_STATUS = new Set([429, 500, 502, 503, 504, 529]);
const MAX_ATTEMPTS = 3;
const BASE_BACKOFF_MS = 500;

export interface ModelAttempt {
  model: string;
  result: 'succeeded' | 'failed';
  status?: number;
  reason?: string;
}

interface ClaudeResponse {
  text: string;
  inputTokens: number;
  outputTokens: number;
  /** The model that actually produced the letter (primary or a fallback). */
  model: string;
  /** Every model tried, in order, with outcome — for internal debugging. */
  modelAttempts: ModelAttempt[];
}

/**
 * Ordered model list: primary first, then configured fallbacks. Read at call time
 * (not import time) so env changes and tests take effect without a restart.
 * The previous single-model default (claude-sonnet-4-20250514) is retired, which
 * silently dropped every defense letter into the deterministic fallback.
 */
export function getConfiguredModels(): string[] {
  const primary = process.env.ANTHROPIC_MODEL_PRIMARY || process.env.ANTHROPIC_MODEL || 'claude-sonnet-5';
  const fallbacks = (process.env.ANTHROPIC_MODEL_FALLBACKS || '')
    .split(',')
    .map((m) => m.trim())
    .filter(Boolean);
  const seen = new Set<string>();
  return [primary, ...fallbacks].filter((m) => (seen.has(m) ? false : (seen.add(m), true)));
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

/**
 * Errors that justify trying the NEXT configured model: the model itself is
 * unavailable (retired/unknown → 404) or this key lacks access to it (403).
 * Deliberately NOT fallback-worthy: 400 (malformed prompt/schema — a product
 * bug every model would hit), 401 (key-level auth — model-independent), and
 * content refusals/format surprises (hiding those behind another model masks bugs).
 */
function isModelFallbackError(err: any): boolean {
  const status = err?.response?.status;
  return status === 404 || status === 403;
}

function errorReason(err: any): string {
  return err?.response?.data?.error?.type
    || err?.response?.data?.error?.message
    || err?.message
    || String(err);
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
 * Per model: retries transient failures (429/5xx/network timeouts) with exponential
 * backoff + jitter, up to MAX_ATTEMPTS. Across models: if the current model is
 * unavailable/inaccessible (404/403) or its transient retries are exhausted, the next
 * model in ANTHROPIC_MODEL_FALLBACKS is tried. Non-retryable, non-availability errors
 * (400/401, refusals, format surprises) throw immediately — falling back there would
 * hide product bugs. Thrown errors carry `modelAttempts` for internal debugging.
 */
export async function callClaude(
  systemPrompt: string,
  userMessage: string,
  maxTokens: number = 4096,
): Promise<ClaudeResponse> {
  if (!config.anthropicApiKey) {
    throw new ExternalServiceError('Anthropic', 'API key not configured');
  }

  const models = getConfiguredModels();
  const modelAttempts: ModelAttempt[] = [];
  let lastErr: any;

  for (const model of models) {
    for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
      try {
        const res = await axios.post(API_URL, {
          model,
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

        modelAttempts.push({ model, result: 'succeeded' });
        return {
          text: content.text,
          inputTokens: res.data.usage?.input_tokens || 0,
          outputTokens: res.data.usage?.output_tokens || 0,
          model,
          modelAttempts,
        };
      } catch (err: any) {
        lastErr = err;
        const retryable = isRetryableError(err);
        const isLastAttempt = attempt === MAX_ATTEMPTS - 1;

        if (retryable && !isLastAttempt) {
          const delay = backoffMs(attempt);
          logger.warn(
            { model, attempt: attempt + 1, maxAttempts: MAX_ATTEMPTS, status: err?.response?.status, delay },
            'Anthropic call failed with transient error; retrying same model',
          );
          await sleep(delay);
          continue;
        }

        modelAttempts.push({
          model,
          result: 'failed',
          status: err?.response?.status,
          reason: errorReason(err),
        });

        // Transient retries exhausted OR the model is unavailable/inaccessible →
        // move to the next configured model. Anything else is a product/config
        // bug that no other model will fix — throw immediately.
        if ((retryable && isLastAttempt) || isModelFallbackError(err)) {
          logger.warn(
            { model, status: err?.response?.status, reason: errorReason(err), remainingModels: models.length - models.indexOf(model) - 1 },
            'Anthropic model unavailable or transient retries exhausted; trying next configured model',
          );
          break; // next model in the outer loop
        }

        (err as any).modelAttempts = modelAttempts;
        throw err;
      }
    }
  }

  logger.error({ modelAttempts }, 'All configured Anthropic models failed');
  if (lastErr) {
    (lastErr as any).modelAttempts = modelAttempts;
    throw lastErr;
  }
  const exhausted = new ExternalServiceError('Anthropic', 'All configured models failed');
  (exhausted as any).modelAttempts = modelAttempts;
  throw exhausted;
}
