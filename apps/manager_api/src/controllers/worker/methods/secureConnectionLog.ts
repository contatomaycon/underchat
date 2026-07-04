import { createHash } from 'node:crypto';
import { logConnectionFlowConsole } from '@core/common/functions/connectionFlowConsoleLog';

export function secureConnectionTokenHash(token?: string): string | undefined {
  if (!token) {
    return undefined;
  }

  return createHash('sha256').update(token).digest('hex').slice(0, 12);
}

export function logSecureConnectionHttpFlow(
  event: string,
  fields: Record<string, unknown> = {}
): void {
  logConnectionFlowConsole(event, {
    layer: 'manager.http.secure_connection',
    ...fields,
  });
}

export function getSecureConnectionErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
