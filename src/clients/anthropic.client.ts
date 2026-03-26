import axios from 'axios';
import { config } from '../config';
import { ExternalServiceError } from '../utils/errors';

const API_URL = 'https://api.anthropic.com/v1/messages';
const MODEL = 'claude-sonnet-4-20250514';

interface ClaudeResponse {
  text: string;
  inputTokens: number;
  outputTokens: number;
}

/**
 * Call Claude API to generate text.
 * Used for defense letter generation and evidence analysis.
 */
export async function callClaude(
  systemPrompt: string,
  userMessage: string,
  maxTokens: number = 4096,
): Promise<ClaudeResponse> {
  if (!config.anthropicApiKey) {
    throw new ExternalServiceError('Anthropic', 'API key not configured');
  }

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
}
