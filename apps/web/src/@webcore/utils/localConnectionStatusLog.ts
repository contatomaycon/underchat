import {
  sanitizeConnectionStatusLogContext,
  sanitizeConnectionStatusLogLabel,
} from './connectionStatusLogSanitizer';

const LOG_PREFIX = '[LOCAL_CONNECTION_STATUS]';

export type LocalConnectionStatusLogContext = Record<string, unknown>;

let localSequence = 0;

export const isLocalConnectionStatusLogEnabled = (): boolean => {
  const env = String(
    import.meta.env.APP_ENVIRONMENT ??
      import.meta.env.VITE_APP_ENVIRONMENT ??
      ''
  ).toUpperCase();

  if (env === 'LOCAL') {
    return true;
  }

  try {
    return (
      globalThis.localStorage?.getItem('underchat_connection_status_log') ===
      '1'
    );
  } catch {
    return false;
  }
};

export const logLocalConnectionStatus = (
  event: string,
  context: LocalConnectionStatusLogContext = {}
): void => {
  if (!isLocalConnectionStatusLogEnabled()) {
    return;
  }

  localSequence += 1;
  const sanitizedContext = sanitizeConnectionStatusLogContext(context);
  if (sanitizedContext.event !== undefined) {
    sanitizedContext.source_event = sanitizedContext.event;
    delete sanitizedContext.event;
  }

  const payload = stabilizePayload({
    seq: localSequence,
    event: sanitizeConnectionStatusLogLabel(event, 'web_status_event'),
    layer: sanitizedContext.layer ?? 'web',
    timestamp: new Date().toISOString(),
    ...sanitizedContext,
  });

  console.log(LOG_PREFIX, JSON.stringify(payload));
};

const stabilizePayload = (
  payload: Record<string, unknown>
): Record<string, unknown> => {
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
};
