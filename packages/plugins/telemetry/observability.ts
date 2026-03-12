import {
  context,
  metrics,
  trace,
  SpanStatusCode,
  ValueType,
  type Attributes,
  type Counter,
  type Histogram,
  type ObservableGauge,
  type Span,
} from '@opentelemetry/api';
import { telemetryEnvironment } from '@core/config/environments';
import { logger } from './logger';

type LogLevel = 'debug' | 'info' | 'warn' | 'error' | 'fatal';
type PrimitiveAttributeValue = string | number | boolean;

export interface ObservabilityEvent {
  message: string;
  category?: string;
  level?: LogLevel;
  data?: Record<string, unknown>;
}

const tracer = trace.getTracer('underchat-observability');
const meter = metrics.getMeter('underchat-observability');

const counters = new Map<string, Counter>();
const histograms = new Map<string, Histogram>();
const gauges = new Map<
  string,
  {
    instrument: ObservableGauge;
    values: Map<string, { value: number; attributes: Attributes }>;
  }
>();

function isConnectionTerminatedError(error: Error): boolean {
  const message = error.message.toLowerCase();
  return (
    message.includes('connection terminated') ||
    message.includes('connection closed') ||
    message.includes('connection ended') ||
    message.includes('server closed the connection') ||
    message.includes('terminating connection due to') ||
    message.includes('terminated unexpectedly') ||
    message.includes('transport closed')
  );
}

function normalizeError(error: unknown): Error {
  if (error instanceof Error) {
    return error;
  }

  if (typeof error === 'object' && error !== null) {
    const errorObj = error as Record<string, unknown>;

    if (errorObj.error instanceof Error) {
      return errorObj.error;
    }

    if (typeof errorObj.message === 'string' && errorObj.message.length > 0) {
      const normalizedError = new Error(errorObj.message);
      if (typeof errorObj.stack === 'string') {
        normalizedError.stack = errorObj.stack;
      }
      return normalizedError;
    }

    return new Error(JSON.stringify(errorObj));
  }

  return new Error(String(error));
}

function normalizeAttributeValue(
  value: unknown
): PrimitiveAttributeValue | null {
  if (
    typeof value === 'string' ||
    typeof value === 'number' ||
    typeof value === 'boolean'
  ) {
    return value;
  }

  if (value === null || value === undefined) {
    return null;
  }

  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

function toAttributes(input?: Record<string, unknown>): Attributes {
  if (!input) {
    return {};
  }

  const output: Attributes = {};

  for (const [key, rawValue] of Object.entries(input)) {
    const value = normalizeAttributeValue(rawValue);
    if (value !== null) {
      output[key] = value;
    }
  }

  return output;
}

function serializeAttributes(attributes: Attributes): string {
  return JSON.stringify(
    Object.entries(attributes)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([key, value]) => [key, String(value)])
  );
}

function getOrCreateCounter(name: string): Counter {
  let counter = counters.get(name);
  if (!counter) {
    counter = meter.createCounter(name);
    counters.set(name, counter);
  }

  return counter;
}

function getOrCreateHistogram(name: string): Histogram {
  let histogram = histograms.get(name);
  if (!histogram) {
    histogram = meter.createHistogram(name, {
      valueType: ValueType.DOUBLE,
    });
    histograms.set(name, histogram);
  }

  return histogram;
}

function getOrCreateGauge(name: string): {
  instrument: ObservableGauge;
  values: Map<string, { value: number; attributes: Attributes }>;
} {
  let gaugeData = gauges.get(name);
  if (!gaugeData) {
    const values = new Map<string, { value: number; attributes: Attributes }>();
    const instrument = meter.createObservableGauge(name, {
      valueType: ValueType.DOUBLE,
    });

    instrument.addCallback((result) => {
      for (const currentValue of values.values()) {
        result.observe(currentValue.value, currentValue.attributes);
      }
    });

    gaugeData = { instrument, values };
    gauges.set(name, gaugeData);
  }

  return gaugeData;
}

export function recordException(
  error: unknown,
  contextData?: Record<string, unknown>
): void {
  if (!telemetryEnvironment.otelEnabled) {
    return;
  }

  const normalizedError = normalizeError(error);

  if (isConnectionTerminatedError(normalizedError)) {
    return;
  }

  const attributes = toAttributes(contextData);
  const activeSpan = trace.getSpan(context.active());

  if (activeSpan) {
    activeSpan.recordException(normalizedError);
    activeSpan.setStatus({
      code: SpanStatusCode.ERROR,
      message: normalizedError.message,
    });
    activeSpan.addEvent('exception', attributes);
    return;
  }

  tracer.startActiveSpan(
    'unhandled.exception',
    { attributes: { ...attributes, 'error.type': normalizedError.name } },
    (span) => {
      span.recordException(normalizedError);
      span.setStatus({
        code: SpanStatusCode.ERROR,
        message: normalizedError.message,
      });
      span.end();
    }
  );
}

export function recordMessage(
  message: string,
  level: LogLevel = 'info',
  contextData?: Record<string, unknown>
): void {
  if (!telemetryEnvironment.otelEnabled) {
    return;
  }

  const attributes = toAttributes(contextData);
  const activeSpan = trace.getSpan(context.active());

  if (activeSpan) {
    activeSpan.addEvent('message', {
      ...attributes,
      'log.message': message,
      'log.severity': level,
    });
  }

  const payload = contextData ? { context: contextData } : undefined;
  logger[level](payload, message);
}

export function addEvent(event: ObservabilityEvent): void {
  if (!telemetryEnvironment.otelEnabled) {
    return;
  }

  const level = event.level ?? 'info';
  const activeSpan = trace.getSpan(context.active());
  const attributes = toAttributes({
    category: event.category,
    ...(event.data || {}),
  });

  if (activeSpan) {
    activeSpan.addEvent(event.message, attributes);
  }

  const payload = event.data
    ? { category: event.category, data: event.data }
    : { category: event.category };
  logger[level](payload, event.message);
}

export function startActiveSpan<T>(
  name: string,
  op: string,
  callback: (span: Span | undefined) => T | Promise<T>
): T | Promise<T> {
  if (!telemetryEnvironment.otelEnabled) {
    return callback(undefined);
  }

  return tracer.startActiveSpan(
    name,
    {
      attributes: {
        'operation.name': op,
      },
    },
    (span) => {
      try {
        const result = callback(span);

        if (result instanceof Promise) {
          return result
            .then((resolved) => {
              span.end();
              return resolved;
            })
            .catch((error) => {
              const normalizedError = normalizeError(error);
              span.recordException(normalizedError);
              span.setStatus({
                code: SpanStatusCode.ERROR,
                message: normalizedError.message,
              });
              span.end();
              throw error;
            });
        }

        span.end();
        return result;
      } catch (error) {
        const normalizedError = normalizeError(error);
        span.recordException(normalizedError);
        span.setStatus({
          code: SpanStatusCode.ERROR,
          message: normalizedError.message,
        });
        span.end();
        throw error;
      }
    }
  );
}

export function incrementCounter(
  name: string,
  value: number = 1,
  attributesInput?: Record<string, unknown>
): void {
  if (!telemetryEnvironment.otelEnabled) {
    return;
  }

  const counter = getOrCreateCounter(name);
  counter.add(value, toAttributes(attributesInput));
}

export function recordGauge(
  name: string,
  value: number,
  attributesInput?: Record<string, unknown>
): void {
  if (!telemetryEnvironment.otelEnabled) {
    return;
  }

  const gauge = getOrCreateGauge(name);
  const attributes = toAttributes(attributesInput);
  const key = serializeAttributes(attributes);
  gauge.values.set(key, { value, attributes });
}

export function recordHistogram(
  name: string,
  value: number,
  attributesInput?: Record<string, unknown>
): void {
  if (!telemetryEnvironment.otelEnabled) {
    return;
  }

  const histogram = getOrCreateHistogram(name);
  histogram.record(value, toAttributes(attributesInput));
}
