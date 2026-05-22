import pino from 'pino';
import { config } from '../config';

export const logger = pino({
  level: config.logLevel,
  redact: {
    paths: [
      'authorization',
      'headers.authorization',
      'req.headers.authorization',
      'token',
      'actionToken',
      'consentToken',
      'link',
      'email',
      'phone',
      '*.authorization',
      '*.token',
      '*.actionToken',
      '*.consentToken',
      '*.link',
      '*.email',
      '*.phone',
    ],
    censor: '[REDACTED]',
  },
  transport: config.isDev
    ? { target: 'pino-pretty', options: { colorize: true, translateTime: 'SYS:HH:MM:ss' } }
    : undefined,
  base: { service: 'scalesafe' },
});
