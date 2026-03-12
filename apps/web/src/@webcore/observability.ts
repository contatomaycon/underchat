import { context, trace, SpanStatusCode } from '@opentelemetry/api';

type LogLevel = 'debug' | 'info' | 'warn' | 'error';

function isConsoleLoggingEnabled(): boolean {
  return import.meta.env.VITE_OTEL_CONSOLE_LOGS === 'true';
}

export interface WebObservabilityEvent {
  message: string;
  category?: string;
  level?: LogLevel;
  data?: Record<string, unknown>;
}

function normalizeError(error: unknown): Error {
  if (error instanceof Error) {
    return error;
  }

  if (typeof error === 'object' && error !== null) {
    const errorObj = error as Record<string, unknown>;
    if (typeof errorObj.message === 'string') {
      return new Error(errorObj.message);
    }

    return new Error(JSON.stringify(errorObj));
  }

  return new Error(String(error));
}

function normalizeAttributeValue(value: unknown): string | number | boolean {
  if (
    typeof value === 'string' ||
    typeof value === 'number' ||
    typeof value === 'boolean'
  ) {
    return value;
  }

  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

function toAttributes(
  input?: Record<string, unknown>
): Record<string, string | number | boolean> {
  if (!input) {
    return {};
  }

  const output: Record<string, string | number | boolean> = {};

  for (const [key, rawValue] of Object.entries(input)) {
    if (rawValue === null || rawValue === undefined) {
      continue;
    }

    output[key] = normalizeAttributeValue(rawValue);
  }

  return output;
}

export function recordException(
  error: unknown,
  contextData?: Record<string, unknown>
): void {
  const normalizedError = normalizeError(error);
  const activeSpan = trace.getSpan(context.active());
  const attributes = toAttributes(contextData);

  if (activeSpan) {
    activeSpan.recordException(normalizedError);
    activeSpan.setStatus({
      code: SpanStatusCode.ERROR,
      message: normalizedError.message,
    });
    activeSpan.addEvent('exception', attributes);
    return;
  }

  const tracer = trace.getTracer('underchat-web');
  tracer.startActiveSpan('web.unhandled.exception', (span) => {
    span.recordException(normalizedError);
    span.setStatus({
      code: SpanStatusCode.ERROR,
      message: normalizedError.message,
    });
    span.addEvent('exception', attributes);
    span.end();
  });
}

export function recordMessage(
  message: string,
  level: LogLevel = 'info',
  contextData?: Record<string, unknown>
): void {
  const activeSpan = trace.getSpan(context.active());
  const attributes = toAttributes({
    level,
    ...(contextData || {}),
  });

  if (activeSpan) {
    activeSpan.addEvent('message', {
      message,
      ...attributes,
    });
  }

  if (!isConsoleLoggingEnabled()) {
    return;
  }

  if (level === 'error') {
    console.error(message, contextData);
  } else if (level === 'warn') {
    console.warn(message, contextData);
  } else if (level === 'debug') {
    console.debug(message, contextData);
  } else {
    console.info(message, contextData);
  }
}

export function addEvent(event: WebObservabilityEvent): void {
  const activeSpan = trace.getSpan(context.active());
  if (activeSpan) {
    activeSpan.addEvent(
      event.message,
      toAttributes({
        category: event.category,
        ...(event.data || {}),
      })
    );
  }

  const level = event.level ?? 'info';
  recordMessage(event.message, level, {
    category: event.category,
    ...(event.data || {}),
  });
}
