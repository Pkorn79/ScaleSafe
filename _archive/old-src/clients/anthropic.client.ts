/**
 * anthropic.client.ts — Claude API Client
 *
 * Wraps the Claude API for generating chargeback defense letters.
 * The defense compiler sends Claude a structured prompt containing all
 * evidence for a disputed contact, and Claude writes a professional
 * defense letter citing specific dates, amounts, and evidence.
 *
 * Uses direct HTTP calls to the Anthropic Messages API rather than
 * the SDK, to keep dependencies minimal. The SDK can be added later
 * if we need streaming or tool use.
 */

import axios from 'axios';
import { config } from '../config';
import { logger } from '../utils/logger';
import { ExternalServiceError } from '../utils/errors';

const ANTHROPIC_API_URL = 'https://api.anthropic.com/v1/messages';
const MODEL = 'claude-sonnet-4-20250514';
const MAX_TOKENS = 4096;

/** Response shape from the Claude Messages API. */
export interface ClaudeResponse {
  content: Array<{ type: string; text: string }>;
  usage: {
    input_tokens: number;
    output_tokens: number;
  };
  model: string;
  stop_reason: string;
}

/**
 * Sends a prompt to Claude and returns the response text + token usage.
 * Used by defense.service to generate defense letters.
 */
export async function generateDefenseLetter(
  systemPrompt: string,
  userPrompt: string
): Promise<{ text: string; inputTokens: number; outputTokens: number }> {
  const apiKey = config.anthropic.apiKey;
  if (!apiKey) {
    throw new ExternalServiceError('Anthropic', 'ANTHROPIC_API_KEY not configured');
  }

  logger.info('Calling Claude API for defense letter generation...');

  try {
    const response = await axios.post<ClaudeResponse>(
      ANTHROPIC_API_URL,
      {
        model: MODEL,
        max_tokens: MAX_TOKENS,
        system: systemPrompt,
        messages: [
          { role: 'user', content: userPrompt },
        ],
      },
      {
        headers: {
          'x-api-key': apiKey,
          'anthropic-version': '2023-06-01',
          'content-type': 'application/json',
        },
        timeout: 120000, // 2 minute timeout — defense letters can take 30-60s
      }
    );

    const data = response.data;
    const text = data.content
      .filter((block) => block.type === 'text')
      .map((block) => block.text)
      .join('\n');

    logger.info(
      {
        inputTokens: data.usage.input_tokens,
        outputTokens: data.usage.output_tokens,
        model: data.model,
      },
      'Claude API response received'
    );

    return {
      text,
      inputTokens: data.usage.input_tokens,
      outputTokens: data.usage.output_tokens,
    };
  } catch (error: any) {
    const errorMessage = error.response?.data?.error?.message || error.message;
    logger.error({ error: errorMessage, status: error.response?.status }, 'Claude API call failed');
    throw new ExternalServiceError('Anthropic', `Defense letter generation failed: ${errorMessage}`);
  }
}
