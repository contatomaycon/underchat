import { createHash } from 'node:crypto';
import { ECodeMessage } from '@core/common/enums/ECodeMessage';
import { EWorkerType } from '@core/common/enums/EWorkerType';
import { IBaileysConnectionState } from '@core/common/interfaces/IBaileysConnectionState';
import { logger } from '@core/plugins/telemetry/logger';

type QrSummaryLevel = 'info' | 'warn' | 'error';

export interface ConnectionQrSummaryInput {
  event: string;
  worker_id?: string;
  account_id?: string;
  connection_attempt_id?: string;
  worker_type?: EWorkerType | string;
  grpc_address?: string;
  status?: string;
  code?: ECodeMessage | number;
  qrcode?: string;
  qr_pending?: boolean;
  recreate_reason?: string;
  reason?: string;
  error?: string;
  level?: QrSummaryLevel;
  attempt?: number;
  max_attempts?: number;
  server_id?: string;
  worker_status_id?: string;
  time_to_first_qr_ms?: number;
  publish_source?: string;
  ignored_stale?: boolean;
  proxy_status?: string;
  proxy_error_code?: string;
  proxy_fallback?: string;
  proxy_bypassed?: boolean;
}

function hashSensitive(value: string | undefined): string | undefined {
  if (!value) {
    return undefined;
  }

  return createHash('sha256').update(value).digest('hex').slice(0, 16);
}

export function summarizeConnectionQrState(
  state: Partial<IBaileysConnectionState>
): Pick<
  ConnectionQrSummaryInput,
  | 'worker_id'
  | 'account_id'
  | 'connection_attempt_id'
  | 'status'
  | 'code'
  | 'qrcode'
  | 'qr_pending'
  | 'attempt'
  | 'max_attempts'
  | 'worker_status_id'
  | 'proxy_status'
  | 'proxy_error_code'
  | 'proxy_fallback'
  | 'proxy_bypassed'
> {
  return {
    worker_id: state.worker_id,
    account_id: state.account_id,
    connection_attempt_id: state.connection_attempt_id,
    status: state.status,
    code: state.code,
    qrcode: state.qrcode,
    qr_pending: state.qr_pending,
    attempt: state.attempt,
    max_attempts: state.max_attempts,
    worker_status_id: state.worker_status_id,
    proxy_status: state.proxy_status,
    proxy_error_code: state.proxy_error_code,
    proxy_fallback: state.proxy_fallback,
    proxy_bypassed: state.proxy_bypassed,
  };
}

export function recordConnectionQrSummary(
  input: ConnectionQrSummaryInput
): void {
  const level = input.level ?? (input.error ? 'error' : 'info');
  const hasQr = Boolean(input.qrcode);
  const payload = {
    log_type: 'connection_qr_summary',
    event: input.event,
    worker_id: input.worker_id,
    account_id: input.account_id,
    connection_attempt_id: input.connection_attempt_id,
    worker_type: input.worker_type,
    grpc_address: input.grpc_address,
    server_id: input.server_id,
    status: input.status,
    code: input.code,
    worker_status_id: input.worker_status_id,
    has_qr: hasQr,
    qr_hash: hashSensitive(input.qrcode),
    qr_length: input.qrcode?.length ?? 0,
    qr_pending: input.qr_pending === true,
    recreate_reason: input.recreate_reason,
    reason: input.reason,
    error: input.error,
    attempt: input.attempt,
    max_attempts: input.max_attempts,
    time_to_first_qr_ms: input.time_to_first_qr_ms,
    publish_source: input.publish_source,
    ignored_stale: input.ignored_stale === true,
    proxy_status: input.proxy_status,
    proxy_error_code: input.proxy_error_code,
    proxy_fallback: input.proxy_fallback,
    proxy_bypassed: input.proxy_bypassed === true,
  };

  logger[level](payload, 'Connection QR summary');
}
