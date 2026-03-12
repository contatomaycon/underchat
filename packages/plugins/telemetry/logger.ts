import pino from 'pino';
import { context, trace } from '@opentelemetry/api';
import { telemetryEnvironment } from '@core/config/environments';

const isDevelopment = process.env.NODE_ENV !== 'production';

export const logger = pino({
  level: telemetryEnvironment.logLevel,
  messageKey: 'message',
  formatters: {
    level: (label) => ({ level: label }),
  },
  mixin() {
    const activeSpan = trace.getSpan(context.active());
    const spanContext = activeSpan?.spanContext();

    if (!spanContext) {
      return {};
    }

    return {
      trace_id: spanContext.traceId,
      span_id: spanContext.spanId,
      trace_flags: spanContext.traceFlags,
    };
  },
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
  base: {
    env: telemetryEnvironment.deploymentEnvironment,
    service: telemetryEnvironment.serviceNameForLogs,
  },
});

export function createChildLogger(
  bindings: Record<string, unknown>
): pino.Logger {
  return logger.child(bindings);
}
