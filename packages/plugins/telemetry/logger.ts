import pino from 'pino';
import { telemetryEnvironment } from '@core/config/environments';

const isDevelopment = process.env.NODE_ENV !== 'production';

export const logger = pino({
  level: telemetryEnvironment.logLevel,
  transport: isDevelopment
    ? {
        target: 'pino-pretty',
        options: {
          colorize: true,
          translateTime: 'HH:MM:ss Z',
          ignore: 'pid,hostname',
        },
      }
    : undefined,
  formatters: {
    level: (label) => {
      return { level: label };
    },
  },
  base: {
    env: process.env.APP_ENVIRONMENT || 'development',
  },
});

export function createChildLogger(
  bindings: Record<string, unknown>
): pino.Logger {
  return logger.child(bindings);
}
