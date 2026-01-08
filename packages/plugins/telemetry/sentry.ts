import * as Sentry from '@sentry/node';
import { telemetryEnvironment } from '@core/config/environments';

export function captureException(
  error: unknown,
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
