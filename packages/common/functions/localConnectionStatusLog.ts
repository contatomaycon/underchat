import { EAppEnvironment } from '@core/common/enums/EAppEnvironment';
import { sanitizeConnectionFlowFields } from '@core/common/functions/connectionFlowConsoleLog';

const LOG_PREFIX = '[LOCAL_CONNECTION_STATUS]';
let localSequence = 0;

export type LocalConnectionStatusLogContext = Record<string, unknown>;

export function isLocalConnectionStatusLogEnabled(): boolean {
  return process.env.APP_ENVIRONMENT === EAppEnvironment.local;
}

export function logLocalConnectionStatus(
  event: string,
  context: LocalConnectionStatusLogContext = {}
): void {
  if (!isLocalConnectionStatusLogEnabled()) {
    return;
  }

  localSequence += 1;
  const sanitizedContext = sanitizeConnectionFlowFields(context);
  if (sanitizedContext.event !== undefined) {
    sanitizedContext.source_event = sanitizedContext.event;
    delete sanitizedContext.event;
  }

  const payload = stabilizePayload({
    seq: localSequence,
    event,
    layer: sanitizedContext.layer ?? 'node',
    timestamp: new Date().toISOString(),
    ...sanitizedContext,
  });

  console.log(LOG_PREFIX, JSON.stringify(payload));
}

function stabilizePayload(
  payload: Record<string, unknown>
): Record<string, unknown> {
  const stableKeys = [
    'seq',
    'event',
    'layer',
    'provider',
    'worker_id',
    'account_id',
    'worker_type_id',
    'worker_status_id',
    'status',
    'code',
    'session_ready',
    'can_send',
    'can_receive_runtime',
    'authenticated',
    'provider_state',
    'degraded_reason',
    'reason',
    'phone',
    'connection_attempt_id',
    'runtime_generation',
    'container_id',
    'offset',
    'timestamp',
  ];
  const output: Record<string, unknown> = {};

  for (const key of stableKeys) {
    if (payload[key] !== undefined) {
      output[key] = payload[key];
    }
  }

  for (const key of Object.keys(payload).sort()) {
    if (output[key] === undefined && payload[key] !== undefined) {
      output[key] = payload[key];
    }
  }

  return output;
}
