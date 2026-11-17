import pino from 'pino';

export const logger = pino({
  name: 'wora-api',
  level: process.env['LOG_LEVEL'] ?? (process.env['NODE_ENV'] === 'production' ? 'info' : 'debug'),
  redact: {
    paths: ['*.apiKey', '*.password', '*.token', '*.authorization', 'req.headers.authorization'],
    censor: '[REDACTED]',
  },
});
