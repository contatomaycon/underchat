import pino from 'pino';
import { context, trace } from '@opentelemetry/api';
import {
  logs,
  SeverityNumber,
  type AnyValueMap,
} from '@opentelemetry/api-logs';
import { telemetryEnvironment } from '@core/config/environments';

const isDevelopment = process.env.NODE_ENV !== 'production';

const otelLogger = logs.getLogger('underchat.pino');

function toSeverityNumber(level: number): SeverityNumber {
  if (level >= 60) {
    return SeverityNumber.FATAL;
  }

  if (level >= 50) {
    return SeverityNumber.ERROR;
  }

  if (level >= 40) {
    return SeverityNumber.WARN;
  }

  if (level >= 30) {
    return SeverityNumber.INFO;
  }

  return SeverityNumber.DEBUG;
}

function toSeverityText(level: number): string {
  if (level >= 60) {
    return 'FATAL';
  }

  if (level >= 50) {
    return 'ERROR';
  }

  if (level >= 40) {
    return 'WARN';
  }

  if (level >= 30) {
    return 'INFO';
  }

  return 'DEBUG';
}

function asLogBody(input: unknown): string {
  if (typeof input === 'string') {
    return input;
  }

  if (input instanceof Error) {
    return input.message;
  }

  return 'log';
}

function normalizeAttributes(input: unknown): AnyValueMap {
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    return {};
  }

  const attributes: AnyValueMap = {};
  for (const [key, value] of Object.entries(input)) {
    if (
      value === null ||
      typeof value === 'string' ||
      typeof value === 'number' ||
      typeof value === 'boolean'
    ) {
      attributes[key] = value;
    }
  }

  return attributes;
}

function emitToOtel(level: number, args: unknown[]): void {
  if (!telemetryEnvironment.otelEnabled) {
    return;
  }

  try {
    const first = args[0];
    const second = args[1];

    const body = asLogBody(typeof first === 'string' ? first : second);
    const firstAttributes = normalizeAttributes(first);
    const secondAttributes = normalizeAttributes(second);

    otelLogger.emit({
      severityNumber: toSeverityNumber(level),
      severityText: toSeverityText(level),
      body,
      attributes: {
        ...firstAttributes,
        ...secondAttributes,
      },
      context: context.active(),
    });
  } catch {
    // Never break application logging due to telemetry export errors.
  }
}

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
  hooks: {
    logMethod(args, method, level) {
      emitToOtel(level, args);
      return method.apply(this, args);
    },
  },
});

export function createChildLogger(
  bindings: Record<string, unknown>
): pino.Logger {
  return logger.child(bindings);
}
