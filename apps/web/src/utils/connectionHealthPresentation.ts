import type { WorkerConnectionHealthResponse } from '@core/schema/worker/workerConnectionLogs/response.schema';
import type { DeepReadonly } from 'vue';
import type { ListWorkerResponse } from '@core/schema/worker/listWorker/response.schema';
import { EWorkerSessionStorage } from '@core/common/enums/EWorkerSessionStorage';
import { EWorkerType } from '@core/common/enums/EWorkerType';

export type ConnectionHealthTone =
  'healthy' | 'attention' | 'critical' | 'neutral';

export type ConnectionHealthMetricKey =
  'disconnections' | 'reconnections' | 'status_changes' | 'last_downtime';

export interface ConnectionHealthMetricDetailRow {
  id: string;
  observedAt: string;
  endedAt: string | null;
  status: string;
  durationSeconds: number | null;
  reason: string | null;
  errorCode: string | null;
  code: string | number | null;
  runtimeGeneration: number;
  authenticated: boolean;
  sessionValid: boolean | null;
  recoverable: boolean;
}

const ONLINE_STATUS = 'online';
const ATTENTION_STATUSES = new Set([
  'initializing',
  'restoring',
  'connecting',
  'qr',
  'reconnecting',
  'handoff',
]);
const CONNECTION_HEALTH_WORKER_TYPES = new Set<string>([
  EWorkerType.baileys,
  EWorkerType.wwebjs,
  EWorkerType.whatsmeow,
]);

export const canViewConnectionHealth = (
  channel: Pick<ListWorkerResponse, 'session_storage' | 'type'>
): boolean =>
  channel.session_storage === EWorkerSessionStorage.postgres &&
  Boolean(channel.type?.id) &&
  CONNECTION_HEALTH_WORKER_TYPES.has(channel.type?.id ?? '');

export const resolveConnectionHealthTone = (
  health: DeepReadonly<WorkerConnectionHealthResponse>
): ConnectionHealthTone => {
  const current = health.current_status;
  if (!current) return 'neutral';

  if (
    current.status === ONLINE_STATUS &&
    current.connected &&
    current.authenticated &&
    current.session_valid === true &&
    current.online_acknowledged &&
    health.lease.active
  ) {
    return 'healthy';
  }

  if (ATTENTION_STATUSES.has(current.status) || current.recoverable) {
    return 'attention';
  }

  return 'critical';
};

export const formatConnectionDuration = (
  seconds: number | null | undefined,
  locale: string
): string => {
  if (seconds === null || seconds === undefined || seconds < 0) return '—';

  const rounded = Math.floor(seconds);
  const days = Math.floor(rounded / 86_400);
  const hours = Math.floor((rounded % 86_400) / 3_600);
  const minutes = Math.floor((rounded % 3_600) / 60);

  const units = [
    days > 0 ? `${days}d` : null,
    hours > 0 ? `${hours}h` : null,
    days === 0 && minutes > 0 ? `${minutes}min` : null,
  ].filter(Boolean);

  if (units.length) return units.slice(0, 2).join(' ');
  return new Intl.NumberFormat(locale).format(rounded) + 's';
};

export const formatConnectionBytes = (
  bytes: number | null | undefined,
  locale: string
): string => {
  if (bytes === null || bytes === undefined || bytes < 0) return '—';
  if (bytes === 0) return '0 B';

  const units = ['B', 'KB', 'MB', 'GB'];
  const unitIndex = Math.min(
    Math.floor(Math.log(bytes) / Math.log(1024)),
    units.length - 1
  );
  const value = bytes / 1024 ** unitIndex;

  return `${new Intl.NumberFormat(locale, {
    maximumFractionDigits: unitIndex === 0 ? 0 : 1,
  }).format(value)} ${units[unitIndex]}`;
};

export const connectionHealthDiagnosticTranslationKey = (
  value: string
): string => {
  const normalized = value
    .trim()
    .replace(/([a-z0-9])([A-Z])/g, '$1_$2')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');

  return `connection_health_diagnostic_${normalized || 'unknown'}`;
};

export const formatConnectionHealthDiagnosticFallback = (
  value: string
): string => {
  const readable = value
    .trim()
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .replace(/[_\-.]+/g, ' ')
    .replace(/\s+/g, ' ')
    .toLowerCase();

  return readable
    ? readable.charAt(0).toLocaleUpperCase() + readable.slice(1)
    : '—';
};

const durationBetween = (startedAt: string, endedAt: string): number | null => {
  const startedAtMs = Date.parse(startedAt);
  const endedAtMs = Date.parse(endedAt);
  if (!Number.isFinite(startedAtMs) || !Number.isFinite(endedAtMs)) return null;

  return Math.max(0, Math.round((endedAtMs - startedAtMs) / 1_000));
};

export const buildConnectionHealthMetricRows = (
  events: DeepReadonly<WorkerConnectionHealthResponse['events']>,
  metric: ConnectionHealthMetricKey
): ConnectionHealthMetricDetailRow[] => {
  const ordered = [...events].sort(
    (left, right) =>
      Date.parse(left.observed_at) - Date.parse(right.observed_at)
  );

  const rows = ordered.flatMap<ConnectionHealthMetricDetailRow>(
    (event, index) => {
      const previous = ordered[index - 1];
      const next = ordered[index + 1];
      if (!previous || previous.status === event.status) return [];

      const isDisconnection =
        previous.status === ONLINE_STATUS && event.status !== ONLINE_STATUS;
      const isReconnection =
        previous.status !== ONLINE_STATUS && event.status === ONLINE_STATUS;

      if (metric === 'disconnections' && !isDisconnection) return [];
      if (
        (metric === 'reconnections' || metric === 'last_downtime') &&
        !isReconnection
      ) {
        return [];
      }

      let observedAt = event.observed_at;
      let endedAt: string | null = next?.observed_at ?? null;
      let durationSeconds = endedAt
        ? durationBetween(observedAt, endedAt)
        : null;

      if (isDisconnection) {
        const recovery = ordered
          .slice(index + 1)
          .find((candidate) => candidate.status === ONLINE_STATUS);
        endedAt = recovery?.observed_at ?? null;
        durationSeconds = endedAt ? durationBetween(observedAt, endedAt) : null;
      }

      if (isReconnection) {
        let outageStartIndex = index - 1;
        while (
          outageStartIndex > 0 &&
          ordered[outageStartIndex - 1]?.status !== ONLINE_STATUS
        ) {
          outageStartIndex -= 1;
        }

        const outageStart = ordered[outageStartIndex];
        durationSeconds = outageStart
          ? durationBetween(outageStart.observed_at, event.observed_at)
          : null;
        endedAt = null;

        if (metric === 'last_downtime' && outageStart) {
          observedAt = outageStart.observed_at;
          endedAt = event.observed_at;
        }
      }

      return [
        {
          id: `${metric}-${event.id}`,
          observedAt,
          endedAt,
          status: event.status,
          durationSeconds,
          reason: event.reason,
          errorCode: event.error_code,
          code: event.code,
          runtimeGeneration: event.runtime_generation,
          authenticated: event.authenticated,
          sessionValid: event.session_valid,
          recoverable: event.recoverable,
        },
      ];
    }
  );

  rows.sort(
    (left, right) => Date.parse(right.observedAt) - Date.parse(left.observedAt)
  );

  return metric === 'last_downtime' ? rows.slice(0, 1) : rows;
};
