/**
 * logger.ts — Structured Logging
 *
 * Uses pino for fast, JSON-structured logging.
 * In development, logs are pretty-printed for readability.
 * In production, logs are JSON for machine parsing (ELK, Datadog, etc.).
 *
 * Usage: import { logger } from './utils/logger'
 *        logger.info('Payment processed', { contactId, amount })
 */

import pino from 'pino';

const isProduction = process.env.NODE_ENV === 'production';

export const logger = pino({
  level: process.env.LOG_LEVEL || 'debug',
  transport: isProduction
    ? undefined
    : {
        target: 'pino-pretty',
        options: {
          colorize: true,
          translateTime: 'SYS:standard',
          ignore: 'pid,hostname',
        },
      },
});
