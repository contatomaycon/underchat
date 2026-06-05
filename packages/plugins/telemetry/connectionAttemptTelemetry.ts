import { createHash } from 'node:crypto';
import { logger } from '@core/plugins/telemetry/logger';
import {
  incrementCounter,
  recordGauge,
  recordHistogram,
} from '@core/plugins/telemetry/observability';
import { recordConnectionLifecycle } from './connectionLifecycleDebug';

type TelemetryLevel = 'info' | 'warn' | 'error';

type MetricEvent =
  | 'qr_request'
  | 'qr_outcome'
  | 'grpc_request'
  | 'container_recreate'
  | 'container_health'
  | 'warm_activation_rejection'
  | 'runtime_generation';

export interface ConnectionAttemptTelemetryInput {
  event: string;
  stage?: string;
  level?: TelemetryLevel;
  metric_event?: MetricEvent;
  worker_id?: string;
  account_id?: string;
  connection_attempt_id?: string;
  connection_lifecycle_id?: string;
  server_id?: string;
  worker_type?: string;
  library?: string;
  status?: string | number | null;
  code?: string | number | null;
  outcome?: string;
  reason?: string;
  error?: string;
  grpc_method?: string;
  grpc_address?: string;
  proxy_status?: string;
  proxy_error_code?: string;
  proxy_fallback?: string;
  proxy_bypassed?: boolean;
  attempt?: number;
  max_attempts?: number;
  deadline_ms?: number;
  duration_ms?: number;
  time_to_first_qr_ms?: number;
  qr_pending_age_ms?: number;
  runtime_generation?: number;
  container_id?: string;
  container_name?: string;
  warm_pool_id?: string;
  recreate_reason?: string;
  health_status_code?: string | number;
  health_failure_reason?: string;
  qrcode?: string;
  has_qr?: boolean;
  [key: string]: unknown;
}

const FIRST_QR_TIMEOUT_DEFAULT_MS = 75_000;
const FIRST_QR_TIMEOUT_MIN_MS = 15_000;
const FIRST_QR_TIMEOUT_MAX_MS = 180_000;
const RECREATE_COOLDOWN_DEFAULT_MS = 60_000;
const RECREATE_COOLDOWN_MIN_MS = 10_000;
const RECREATE_COOLDOWN_MAX_MS = 300_000;

const METRIC_NAMES = {
  qrRequests: 'underchat_connection_qr_requests_total',
  qrOutcomes: 'underchat_connection_qr_outcomes_total',
  timeToFirstQr: 'underchat_connection_qr_time_to_first_qr_ms',
  pendingAge: 'underchat_connection_qr_pending_age_ms',
  containerRecreates: 'underchat_connection_container_recreates_total',
  containerHealthChecks: 'underchat_connection_container_health_checks_total',
  grpcRequests: 'underchat_connection_grpc_requests_total',
  warmActivationRejections: 'underchat_warm_pool_activation_rejections_total',
  runtimeGeneration: 'underchat_worker_runtime_generation',
} as const;

function readBoundedIntEnv(
  key: string,
  fallback: number,
  min: number,
  max: number
): number {
  const parsed = Number.parseInt(process.env[key] ?? '', 10);
  if (!Number.isFinite(parsed)) {
    return fallback;
  }

  return Math.min(max, Math.max(min, parsed));
}

export function getConnectionQrFirstQrTimeoutMs(): number {
  return readBoundedIntEnv(
    'CONNECTION_QR_FIRST_QR_TIMEOUT_MS',
    FIRST_QR_TIMEOUT_DEFAULT_MS,
    FIRST_QR_TIMEOUT_MIN_MS,
    FIRST_QR_TIMEOUT_MAX_MS
  );
}

export function getConnectionQrRecreateCooldownMs(): number {
  return readBoundedIntEnv(
    'CONNECTION_QR_RECREATE_COOLDOWN_MS',
    RECREATE_COOLDOWN_DEFAULT_MS,
    RECREATE_COOLDOWN_MIN_MS,
    RECREATE_COOLDOWN_MAX_MS
  );
}

function hashSensitive(value: string | undefined): string | undefined {
  if (!value) {
    return undefined;
  }

  return createHash('sha256').update(value).digest('hex').slice(0, 16);
}

function metricLabels(
  input: ConnectionAttemptTelemetryInput
): Record<string, string | number | boolean | undefined> {
  return {
    worker_type: input.worker_type,
    library: input.library,
    server_id: input.server_id,
    stage: input.stage,
    outcome: input.outcome,
    reason: input.reason ?? input.recreate_reason,
    grpc_method: input.grpc_method,
    proxy_status: input.proxy_status,
  };
}

function recordMetric(input: ConnectionAttemptTelemetryInput): void {
  const labels = metricLabels(input);

  switch (input.metric_event) {
    case 'qr_request':
      incrementCounter(METRIC_NAMES.qrRequests, 1, labels);
      break;
    case 'qr_outcome':
      incrementCounter(METRIC_NAMES.qrOutcomes, 1, labels);
      if (typeof input.time_to_first_qr_ms === 'number') {
        recordHistogram(
          METRIC_NAMES.timeToFirstQr,
          input.time_to_first_qr_ms,
          labels
        );
      }
      if (typeof input.qr_pending_age_ms === 'number') {
        recordHistogram(
          METRIC_NAMES.pendingAge,
          input.qr_pending_age_ms,
          labels
        );
      }
      break;
    case 'grpc_request':
      incrementCounter(METRIC_NAMES.grpcRequests, 1, labels);
      break;
    case 'container_recreate':
      incrementCounter(METRIC_NAMES.containerRecreates, 1, labels);
      break;
    case 'container_health':
      incrementCounter(METRIC_NAMES.containerHealthChecks, 1, labels);
      break;
    case 'warm_activation_rejection':
      incrementCounter(METRIC_NAMES.warmActivationRejections, 1, labels);
      break;
    case 'runtime_generation':
      if (typeof input.runtime_generation === 'number') {
        recordGauge(METRIC_NAMES.runtimeGeneration, input.runtime_generation, {
          worker_type: input.worker_type,
          server_id: input.server_id,
        });
      }
      break;
    default:
      break;
  }
}

export function recordConnectionAttemptTelemetry(
  input: ConnectionAttemptTelemetryInput
): void {
  const level = input.level ?? (input.error ? 'error' : 'info');
  const hasQr = input.has_qr ?? Boolean(input.qrcode);
  const payload = {
    ...input,
    log_type: 'connection_attempt_summary',
    timestamp_utc: new Date().toISOString(),
    has_qr: hasQr,
    qr_hash: hashSensitive(input.qrcode),
    qr_length: input.qrcode?.length ?? 0,
    qrcode: undefined,
  };

  recordMetric(input);
  recordConnectionLifecycle({
    ...input,
    stage: input.stage ?? `connection.attempt.${input.event}`,
    decision: input.event,
    outcome: input.outcome ?? (input.error ? 'error' : 'logged'),
    level,
    status:
      input.status === null || input.status === undefined
        ? input.status
        : String(input.status),
  });

  logger[level](payload, 'Connection attempt summary');
}
