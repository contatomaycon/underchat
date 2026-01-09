import * as Sentry from '@sentry/node';
import { telemetryEnvironment } from '@core/config/environments';

function isConnectionTerminatedError(error: unknown): boolean {
  if (!(error instanceof Error)) {
    return false;
  }

  const message = error.message.toLowerCase();
  return (
    message.includes('connection terminated') ||
    message.includes('connection closed') ||
    message.includes('connection ended') ||
    message.includes('server closed the connection') ||
    message.includes('terminating connection due to') ||
    message.includes('terminated unexpectedly')
  );
}

export function captureException(
  error: unknown,
  context?: Record<string, unknown>
): void {
  if (!telemetryEnvironment.enableSentry) {
    return;
  }

  if (isConnectionTerminatedError(error)) {
    return;
  }

  if (context) {

    Sentry.withScope((scope) => {
      Object.entries(context).forEach(([key, value]) => {
        scope.setContext(key, value as Record<string, unknown>);
      });
      Sentry.captureException(error);
    });
    return;
  }

  Sentry.captureException(error);
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
    Sentry.withScope((scope) => {
      Object.entries(context).forEach(([key, value]) => {
        scope.setContext(key, value as Record<string, unknown>);
      });
      Sentry.captureMessage(message, level);
    });
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
