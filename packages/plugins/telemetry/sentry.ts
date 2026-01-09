import * as Sentry from '@sentry/node';
import { telemetryEnvironment } from '@core/config/environments';

function isConnectionTerminatedError(error: unknown): boolean {
  if (!(error instanceof Error)) {
    return false;
  }

  const message = error.message.toLowerCase();

  if (
    message.includes('connection terminated') ||
    message.includes('connection closed') ||
    message.includes('connection ended') ||
    message.includes('server closed the connection') ||
    message.includes('terminating connection due to') ||
    message.includes('terminated unexpectedly') ||
    message.includes('transport closed')
  ) {
    return true;
  }

  try {
    const parsed = JSON.parse(error.message);
    if (typeof parsed === 'object' && parsed !== null) {
      const parsedMessage = String(parsed.message || '').toLowerCase();
      if (parsedMessage.includes('transport closed')) {
        return true;
      }
    }
  } catch {}

  return false;
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

    if (typeof errorObj.error === 'object' && errorObj.error !== null) {
      const innerError = errorObj.error as Record<string, unknown>;
      if (innerError.message && typeof innerError.message === 'string') {
        const normalizedError = new Error(innerError.message);
        if (innerError.stack && typeof innerError.stack === 'string') {
          normalizedError.stack = innerError.stack;
        }
        return normalizedError;
      }
      return new Error(JSON.stringify(innerError));
    }

    if (errorObj.message && typeof errorObj.message === 'string') {
      const normalizedError = new Error(errorObj.message);
      if (errorObj.stack && typeof errorObj.stack === 'string') {
        normalizedError.stack = errorObj.stack;
      }
      return normalizedError;
    }

    return new Error(
      String(errorObj.error || errorObj.message || 'Unknown error')
    );
  }

  return new Error(String(error));
}

export function captureException(
  error: unknown,
  context?: Record<string, unknown>
): void {
  if (!telemetryEnvironment.enableSentry) {
    return;
  }

  const normalizedError = normalizeError(error);

  if (isConnectionTerminatedError(normalizedError)) {
    return;
  }

  if (context) {
    try {
      Sentry.withScope((scope) => {
        Object.entries(context).forEach(([key, value]) => {
          scope.setContext(key, value as Record<string, unknown>);
        });
        Sentry.captureException(normalizedError);
      });
    } catch {
      Object.entries(context).forEach(([key, value]) => {
        try {
          Sentry.setContext(key, value as Record<string, unknown>);
        } catch {}
      });
      Sentry.captureException(normalizedError);
    }
    return;
  }

  Sentry.captureException(normalizedError);
}

export function captureMessage(
  message: string,
  level: Sentry.SeverityLevel = 'info',
  context?: Record<string, unknown>
): void {
  if (!telemetryEnvironment.enableSentry) {
    return;
  }

  if (context) {
    try {
      Sentry.withScope((scope) => {
        Object.entries(context).forEach(([key, value]) => {
          scope.setContext(key, value as Record<string, unknown>);
        });
        Sentry.captureMessage(message, level);
      });
    } catch {
      Object.entries(context).forEach(([key, value]) => {
        try {
          Sentry.setContext(key, value as Record<string, unknown>);
        } catch {}
      });
      Sentry.captureMessage(message, level);
    }
    return;
  }

  Sentry.captureMessage(message, level);
}

export function setUser(user: {
  id?: string;
  email?: string;
  username?: string;
}): void {
  if (!telemetryEnvironment.enableSentry) {
    return;
  }

  Sentry.setUser(user);
}

export function addBreadcrumb(breadcrumb: Sentry.Breadcrumb): void {
  if (!telemetryEnvironment.enableSentry) {
    return;
  }

  Sentry.addBreadcrumb(breadcrumb);
}

export function startSpan<T>(
  name: string,
  op: string,
  callback: (span: Sentry.Span | undefined) => T
): T {
  if (!telemetryEnvironment.enableSentry) {
    return callback(undefined);
  }

  return Sentry.startSpan({ name, op }, callback);
}

export function metricsCount(
  name: string,
  value: number = 1,
  attributes?: Record<string, string | number>
): void {
  if (!telemetryEnvironment.enableSentry) {
    return;
  }

  Sentry.metrics.count(name, value, attributes ? { attributes } : undefined);
}

export function metricsGauge(
  name: string,
  value: number,
  attributes?: Record<string, string | number>
): void {
  if (!telemetryEnvironment.enableSentry) {
    return;
  }

  Sentry.metrics.gauge(name, value, attributes ? { attributes } : undefined);
}

export function metricsDistribution(
  name: string,
  value: number,
  attributes?: Record<string, string | number>
): void {
  if (!telemetryEnvironment.enableSentry) {
    return;
  }

  Sentry.metrics.distribution(
    name,
    value,
    attributes ? { attributes } : undefined
  );
}
