import { DrizzleQueryError } from 'drizzle-orm';
import { logger } from '@core/plugins/telemetry/logger';
import { recordException } from '@core/plugins/telemetry/observability';

export function logDatabaseError(
  error: unknown,
  context?: {
    operation?: string;
    table?: string;
    query?: string;
    params?: unknown;
  }
): void {
  const isDrizzleError = error instanceof DrizzleQueryError;

  logger.error(
    {
      err: error,
      type: 'database_error',
      operation: context?.operation,
      table: context?.table,
      query: context?.query,
      params: context?.params,
      isDrizzleError,
    },
    'Database error occurred'
  );

  recordException(error, {
    database: {
      operation: context?.operation,
      table: context?.table,
      query: context?.query,
      isDrizzleError,
    },
  });
}
