import { inject, injectable } from 'tsyringe';
import { sql } from 'drizzle-orm';
import type { NodePgDatabase } from 'drizzle-orm/node-postgres';
import type * as schema from '@core/models';
import type { WorkerConnectionHealthResponse } from '@core/schema/worker/workerConnectionLogs/response.schema';
import { normalizeWhatsappConnectionStatus } from '@core/common/functions/whatsappConnectionStatus';

type WorkerConnectionHealthDatabaseResponse = Omit<
  WorkerConnectionHealthResponse,
  'logs' | 'logs_has_more'
>;

interface WorkerConnectionHealthSnapshotRow {
  worker_id: string;
  worker_name: string;
  worker_number: string | null;
  provider: 'baileys' | 'wwebjs' | 'whatsmeow';
  worker_status_id: string;
  worker_status_name: string | null;
  server_name: string | null;
  connection_date: string | null;
  last_connection_check_at: string | null;
  worker_created_at: string | null;
  worker_updated_at: string | null;
  current_status: unknown;
  current_status_source_id: string | null;
  online_acknowledged: boolean;
  runtime_generation: number | null;
  session_state: string;
  session_generation: number;
  active_revision_id: number | string | null;
  active_revision_status: string | null;
  active_revision_size_bytes: number | string | null;
  schema_version: number | null;
  last_persisted_at: string | null;
  last_error_at: string | null;
  revision_promoted_at: string | null;
  revision_count: number | string;
  failed_revision_count: number | string;
  protected_record_count: number | string;
  artifact_count: number | string;
  artifact_size_bytes: number | string;
  device_registered: boolean;
  lease_active: boolean;
  lease_acquired_at: string | null;
  lease_heartbeat_at: string | null;
  lease_expires_at: string | null;
}

interface WorkerConnectionHealthHistoryRow {
  metrics: WorkerConnectionHealthResponse['metrics'];
  timeline: WorkerConnectionHealthResponse['timeline'];
  events: WorkerConnectionHealthResponse['events'];
}

const toNumber = (value: number | string | null | undefined): number => {
  const parsed = Number(value ?? 0);
  return Number.isFinite(parsed) ? parsed : 0;
};

const toNullableNumber = (
  value: number | string | null | undefined
): number | null =>
  value === null || value === undefined ? null : toNumber(value);

const rowsFromResult = <T>(result: unknown): T[] =>
  ((result as { rows?: T[] }).rows ?? []) as T[];

/**
 * Reads secret-free operational health for database-backed WhatsApp sessions.
 * Provider payloads, credential records, hashes, lease owners and container
 * identifiers never cross this repository boundary.
 */
@injectable()
export class WorkerConnectionHealthRepository {
  constructor(
    @inject('DatabaseRw')
    private readonly dbRw: NodePgDatabase<typeof schema>
  ) {}

  async view(input: {
    accountId: string;
    workerId: string;
    periodHours: 24 | 72 | 168;
  }): Promise<WorkerConnectionHealthDatabaseResponse | null> {
    const [snapshotResult, historyResult] = await Promise.all([
      this.dbRw.execute(sql`
        SELECT owner.worker_id::text AS worker_id,
          owner.name AS worker_name,
          owner.number AS worker_number,
          COALESCE(
            session.provider,
            runtime.source_provider,
            CASE owner.worker_type_id::text
              WHEN '019a930d-c6f6-766d-9c84-53307d4159a1'
                THEN 'baileys'
              WHEN '019a930d-c6f6-766d-9c84-62b9c3e7d1f0'
                THEN 'wwebjs'
              WHEN 'e80ad183-2b46-4628-9105-a036f2d28720'
                THEN 'whatsmeow'
            END
          ) AS provider,
          owner.worker_status_id::text AS worker_status_id,
          worker_status.status AS worker_status_name,
          server.name AS server_name,
          owner.connection_date::text AS connection_date,
          owner.last_connection_check_at::text AS last_connection_check_at,
          owner.created_at::text AS worker_created_at,
          owner.updated_at::text AS worker_updated_at,
          runtime.native_connection_public_status AS current_status,
          runtime.native_connection_status_source_id::text
            AS current_status_source_id,
          COALESCE(runtime.native_connection_online_acknowledged, false)
            AND lease.owner_id IS NOT NULL
            AND lease.expires_at > clock_timestamp()
            AS online_acknowledged,
          runtime.runtime_generation,
          COALESCE(session.state, 'empty') AS session_state,
          COALESCE(session.generation, runtime.runtime_generation, 1)
            AS session_generation,
          session.active_revision_id AS active_revision_id,
          revision.status AS active_revision_status,
          revision.size_bytes AS active_revision_size_bytes,
          revision.schema_version,
          session.last_persisted_at::text AS last_persisted_at,
          session.last_error_at::text AS last_error_at,
          revision.promoted_at::text AS revision_promoted_at,
          (
            SELECT count(*)
            FROM public.whatsapp_session_revision AS counted_revision
            WHERE counted_revision.session_id = owner.worker_id
          ) AS revision_count,
          (
            SELECT count(*)
            FROM public.whatsapp_session_revision AS failed_revision
            WHERE failed_revision.session_id = owner.worker_id
              AND failed_revision.status = 'failed'
          ) AS failed_revision_count,
          (
            SELECT count(*)
            FROM public.whatsapp_provider_record AS provider_record
            WHERE provider_record.session_id = owner.worker_id
              AND provider_record.revision_id = session.active_revision_id
          ) AS protected_record_count,
          (
            SELECT count(*)
            FROM public.whatsapp_artifact AS artifact
            WHERE artifact.session_id = owner.worker_id
              AND artifact.revision_id = session.active_revision_id
              AND artifact.status = 'ready'
          ) AS artifact_count,
          COALESCE((
            SELECT sum(artifact.size_bytes)
            FROM public.whatsapp_artifact AS artifact
            WHERE artifact.session_id = owner.worker_id
              AND artifact.revision_id = session.active_revision_id
              AND artifact.status = 'ready'
          ), 0) AS artifact_size_bytes,
          EXISTS (
            SELECT 1
            FROM public.whatsapp_device AS device
            WHERE device.session_id = owner.worker_id
              AND device.revision_id = session.active_revision_id
              AND device.jid IS NOT NULL
          ) AS device_registered,
          lease.owner_id IS NOT NULL
            AND lease.provider = session.provider
            AND lease.generation = session.generation
            AND lease.expires_at > clock_timestamp()
            AS lease_active,
          lease.acquired_at::text AS lease_acquired_at,
          lease.heartbeat_at::text AS lease_heartbeat_at,
          lease.expires_at::text AS lease_expires_at
        FROM public.worker AS owner
        JOIN public.worker_status AS worker_status
          ON worker_status.worker_status_id = owner.worker_status_id
        LEFT JOIN public.server AS server
          ON server.server_id = owner.server_id
        LEFT JOIN public.worker_runtime AS runtime
          ON runtime.worker_id = owner.worker_id
         AND runtime.session_storage = owner.session_storage
        LEFT JOIN public.whatsapp_session AS session
          ON session.session_id = owner.worker_id
        LEFT JOIN public.whatsapp_session_revision AS revision
          ON revision.session_id = session.session_id
         AND revision.revision_id = session.active_revision_id
        LEFT JOIN public.whatsapp_session_lease AS lease
          ON lease.session_id = session.session_id
        WHERE owner.worker_id = ${input.workerId}::uuid
          AND owner.account_id = ${input.accountId}::uuid
          AND owner.session_storage = 'postgres'
          AND owner.deleted_at IS NULL
        LIMIT 1
      `),
      this.dbRw.execute(sql`
        WITH bounds AS MATERIALIZED (
          SELECT clock_timestamp() AS window_end,
            clock_timestamp() - (${input.periodHours}::integer * interval '1 hour')
              AS window_start
        ), authorized_worker AS MATERIALIZED (
          SELECT owner.worker_id,
            owner.account_id,
            runtime.native_connection_public_status AS current_status
          FROM public.worker AS owner
          LEFT JOIN public.worker_runtime AS runtime
            ON runtime.worker_id = owner.worker_id
           AND runtime.session_storage = owner.session_storage
          WHERE owner.worker_id = ${input.workerId}::uuid
            AND owner.account_id = ${input.accountId}::uuid
            AND owner.session_storage = 'postgres'
            AND owner.deleted_at IS NULL
        ), status_events AS MATERIALIZED (
          SELECT outbox.outbox_id,
            outbox.runtime_generation,
            outbox.created_at AS observed_at,
            outbox.payload -> 'connection_status' ->> 'status' AS status,
            COALESCE(
              (outbox.payload -> 'connection_status' ->> 'connected')::boolean,
              false
            ) AS connected,
            COALESCE(
              (outbox.payload -> 'connection_status' ->> 'authenticated')::boolean,
              false
            ) AS authenticated,
            CASE
              WHEN outbox.payload -> 'connection_status' -> 'sessionValid'
                = 'null'::jsonb THEN NULL
              ELSE (outbox.payload -> 'connection_status' ->> 'sessionValid')::boolean
            END AS session_valid,
            COALESCE(
              (outbox.payload -> 'connection_status' ->> 'recoverable')::boolean,
              false
            ) AS recoverable,
            NULLIF(
              btrim(outbox.payload -> 'connection_status' ->> 'reason'),
              ''
            ) AS reason,
            NULLIF(
              btrim(outbox.payload -> 'connection_status' ->> 'errorCode'),
              ''
            ) AS error_code,
            NULLIF(btrim(outbox.payload ->> 'code'), '') AS code
          FROM public.worker_runtime_event_outbox AS outbox
          JOIN authorized_worker AS authorized
            ON authorized.worker_id = outbox.worker_id
           AND authorized.account_id = outbox.account_id
          CROSS JOIN bounds
          WHERE outbox.event_type = 'status'
            AND jsonb_typeof(outbox.payload -> 'connection_status') = 'object'
            AND outbox.created_at >= bounds.window_start - interval '7 days'
            AND outbox.created_at <= bounds.window_end
        ), carry_event AS MATERIALIZED (
          SELECT event.*
          FROM status_events AS event
          CROSS JOIN bounds
          WHERE event.observed_at < bounds.window_start
          ORDER BY event.observed_at DESC, event.outbox_id DESC
          LIMIT 1
        ), window_events AS MATERIALIZED (
          SELECT event.*
          FROM status_events AS event
          CROSS JOIN bounds
          WHERE event.observed_at >= bounds.window_start
            AND event.observed_at <= bounds.window_end
        ), synthetic_current AS MATERIALIZED (
          SELECT 0::bigint AS outbox_id,
            1::integer AS runtime_generation,
            bounds.window_start AS observed_at,
            authorized.current_status ->> 'status' AS status,
            COALESCE(
              (authorized.current_status ->> 'connected')::boolean,
              false
            ) AS connected,
            COALESCE(
              (authorized.current_status ->> 'authenticated')::boolean,
              false
            ) AS authenticated,
            CASE
              WHEN authorized.current_status -> 'sessionValid' = 'null'::jsonb
                THEN NULL
              ELSE (authorized.current_status ->> 'sessionValid')::boolean
            END AS session_valid,
            COALESCE(
              (authorized.current_status ->> 'recoverable')::boolean,
              false
            ) AS recoverable,
            NULLIF(btrim(authorized.current_status ->> 'reason'), '') AS reason,
            NULLIF(btrim(authorized.current_status ->> 'errorCode'), '')
              AS error_code,
            NULL::text AS code
          FROM authorized_worker AS authorized
          CROSS JOIN bounds
          WHERE jsonb_typeof(authorized.current_status) = 'object'
            AND NOT EXISTS (SELECT 1 FROM carry_event)
            AND NOT EXISTS (SELECT 1 FROM window_events)
        ), effective_events AS MATERIALIZED (
          SELECT * FROM carry_event
          UNION ALL
          SELECT * FROM window_events
          UNION ALL
          SELECT * FROM synthetic_current
        ), ordered_events AS MATERIALIZED (
          SELECT event.*,
            lag(event.status) OVER (
              ORDER BY event.observed_at, event.outbox_id
            ) AS previous_status,
            lead(event.observed_at, 1, bounds.window_end) OVER (
              ORDER BY event.observed_at, event.outbox_id
            ) AS next_observed_at,
            bounds.window_start,
            bounds.window_end
          FROM effective_events AS event
          CROSS JOIN bounds
        ), segments AS MATERIALIZED (
          SELECT event.*,
            greatest(event.observed_at, event.window_start) AS segment_start,
            least(event.next_observed_at, event.window_end) AS segment_end
          FROM ordered_events AS event
          WHERE event.next_observed_at > event.window_start
            AND event.observed_at < event.window_end
        ), metric_values AS MATERIALIZED (
          SELECT COALESCE(sum(
              extract(epoch FROM (segment.segment_end - segment.segment_start))
            ), 0) AS observed_seconds,
            COALESCE(sum(
              CASE WHEN segment.status = 'online' AND segment.connected
                THEN extract(epoch FROM (
                  segment.segment_end - segment.segment_start
                )) ELSE 0 END
            ), 0) AS online_seconds,
            count(*) FILTER (
              WHERE segment.observed_at >= segment.window_start
                AND segment.previous_status IS DISTINCT FROM segment.status
            ) AS status_changes,
            count(*) FILTER (
              WHERE segment.observed_at >= segment.window_start
                AND segment.previous_status = 'online'
                AND segment.status <> 'online'
            ) AS disconnections,
            count(*) FILTER (
              WHERE segment.observed_at >= segment.window_start
                AND segment.previous_status IS NOT NULL
                AND segment.previous_status <> 'online'
                AND segment.status = 'online'
            ) AS reconnections,
            (
              SELECT extract(epoch FROM (
                completed.segment_end - completed.segment_start
              ))
              FROM segments AS completed
              WHERE completed.status <> 'online'
                AND completed.segment_end < completed.window_end
              ORDER BY completed.segment_end DESC
              LIMIT 1
            ) AS last_downtime_seconds
          FROM segments AS segment
        ), buckets AS MATERIALIZED (
          SELECT bucket.bucket_start,
            least(bucket.bucket_start + interval '1 hour', bounds.window_end)
              AS bucket_end
          FROM bounds
          CROSS JOIN LATERAL generate_series(
            date_trunc('hour', bounds.window_start),
            bounds.window_end,
            interval '1 hour'
          ) AS bucket(bucket_start)
        ), bucket_values AS MATERIALIZED (
          SELECT bucket.bucket_start,
            COALESCE(sum(greatest(0, extract(epoch FROM (
              least(segment.segment_end, bucket.bucket_end)
              - greatest(segment.segment_start, bucket.bucket_start)
            )))), 0) AS observed_seconds,
            COALESCE(sum(
              CASE WHEN segment.status = 'online' AND segment.connected
                THEN greatest(0, extract(epoch FROM (
                  least(segment.segment_end, bucket.bucket_end)
                  - greatest(segment.segment_start, bucket.bucket_start)
                ))) ELSE 0 END
            ), 0) AS online_seconds,
            (
              SELECT count(*)
              FROM window_events AS event
              WHERE event.observed_at >= bucket.bucket_start
                AND event.observed_at < bucket.bucket_end
            ) AS event_count
          FROM buckets AS bucket
          LEFT JOIN segments AS segment
            ON segment.segment_end > bucket.bucket_start
           AND segment.segment_start < bucket.bucket_end
          GROUP BY bucket.bucket_start, bucket.bucket_end
          ORDER BY bucket.bucket_start
        ), current_projection AS MATERIALIZED (
          SELECT authorized.current_status
          FROM authorized_worker AS authorized
          LIMIT 1
        )
        SELECT jsonb_build_object(
            'period_hours', ${input.periodHours}::integer,
            'window_started_at', bounds.window_start::text,
            'window_ended_at', bounds.window_end::text,
            'availability_percentage', CASE
              WHEN metric.observed_seconds <= 0 THEN NULL
              ELSE round(
                (metric.online_seconds * 100 / metric.observed_seconds)::numeric,
                2
              )::double precision
            END,
            'observed_seconds', round(metric.observed_seconds)::integer,
            'online_seconds', round(metric.online_seconds)::integer,
            'offline_seconds', round(
              greatest(metric.observed_seconds - metric.online_seconds, 0)
            )::integer,
            'status_changes', metric.status_changes::integer,
            'disconnections', metric.disconnections::integer,
            'reconnections', metric.reconnections::integer,
            'current_uptime_seconds', CASE
              WHEN current.current_status ->> 'status' = 'online'
                AND current.current_status ->> 'changedAt'
                  ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}T'
                THEN greatest(0, extract(epoch FROM (
                  bounds.window_end
                  - (current.current_status ->> 'changedAt')::timestamptz
                )))::integer
              ELSE NULL
            END,
            'last_downtime_seconds',
              round(metric.last_downtime_seconds)::integer
          ) AS metrics,
          COALESCE((
            SELECT jsonb_agg(jsonb_build_object(
              'started_at', bucket.bucket_start::text,
              'availability_percentage', CASE
                WHEN bucket.observed_seconds <= 0 THEN NULL
                ELSE round((
                  bucket.online_seconds * 100 / bucket.observed_seconds
                )::numeric, 2)::double precision
              END,
              'observed_seconds', round(bucket.observed_seconds)::integer,
              'online_seconds', round(bucket.online_seconds)::integer,
              'event_count', bucket.event_count::integer
            ) ORDER BY bucket.bucket_start)
            FROM bucket_values AS bucket
          ), '[]'::jsonb) AS timeline,
          COALESCE((
            SELECT jsonb_agg(jsonb_build_object(
              'id', recent.outbox_id::text,
              'status', recent.status,
              'connected', recent.connected,
              'authenticated', recent.authenticated,
              'session_valid', recent.session_valid,
              'recoverable', recent.recoverable,
              'observed_at', recent.observed_at::text,
              'reason', recent.reason,
              'error_code', recent.error_code,
              'code', recent.code,
              'runtime_generation', recent.runtime_generation
            ) ORDER BY recent.observed_at DESC, recent.outbox_id DESC)
            FROM (
              SELECT event.*
              FROM window_events AS event
              ORDER BY event.observed_at DESC, event.outbox_id DESC
              LIMIT 80
            ) AS recent
          ), '[]'::jsonb) AS events
        FROM bounds
        CROSS JOIN metric_values AS metric
        LEFT JOIN current_projection AS current ON true
      `),
    ]);

    const snapshot =
      rowsFromResult<WorkerConnectionHealthSnapshotRow>(snapshotResult)[0];
    const history =
      rowsFromResult<WorkerConnectionHealthHistoryRow>(historyResult)[0];

    if (!snapshot || !history) {
      return null;
    }

    const normalizedStatus = normalizeWhatsappConnectionStatus(
      snapshot.current_status,
      snapshot.provider
    );

    return {
      generated_at: new Date().toISOString(),
      channel: {
        id: snapshot.worker_id,
        name: snapshot.worker_name,
        number: snapshot.worker_number,
        worker_status: {
          id: snapshot.worker_status_id,
          name: snapshot.worker_status_name,
        },
        server_name: snapshot.server_name,
        connection_date: snapshot.connection_date,
        last_connection_check_at: snapshot.last_connection_check_at,
        created_at: snapshot.worker_created_at,
        updated_at: snapshot.worker_updated_at,
      },
      current_status: normalizedStatus
        ? {
            status: normalizedStatus.status,
            connected: normalizedStatus.connected,
            authenticated: normalizedStatus.authenticated,
            session_valid: normalizedStatus.sessionValid,
            recoverable: normalizedStatus.recoverable,
            qr_available: normalizedStatus.qrAvailable,
            changed_at: normalizedStatus.changedAt,
            reason: normalizedStatus.reason ?? null,
            error_code: normalizedStatus.errorCode ?? null,
            sequence: normalizedStatus.sequence,
            source_id: snapshot.current_status_source_id,
            online_acknowledged: snapshot.online_acknowledged,
            runtime_generation: snapshot.runtime_generation,
          }
        : null,
      session: {
        state: snapshot.session_state,
        generation: toNumber(snapshot.session_generation),
        active_revision_id:
          snapshot.active_revision_id === null
            ? null
            : String(snapshot.active_revision_id),
        active_revision_status: snapshot.active_revision_status,
        active_revision_size_bytes: toNullableNumber(
          snapshot.active_revision_size_bytes
        ),
        schema_version: toNullableNumber(snapshot.schema_version),
        last_persisted_at: snapshot.last_persisted_at,
        last_error_at: snapshot.last_error_at,
        revision_promoted_at: snapshot.revision_promoted_at,
        revision_count: toNumber(snapshot.revision_count),
        failed_revision_count: toNumber(snapshot.failed_revision_count),
        protected_record_count: toNumber(snapshot.protected_record_count),
        artifact_count: toNumber(snapshot.artifact_count),
        artifact_size_bytes: toNumber(snapshot.artifact_size_bytes),
        device_registered: snapshot.device_registered,
      },
      lease: {
        active: snapshot.lease_active,
        acquired_at: snapshot.lease_acquired_at,
        heartbeat_at: snapshot.lease_heartbeat_at,
        expires_at: snapshot.lease_expires_at,
      },
      metrics: history.metrics,
      timeline: history.timeline,
      events: history.events,
    };
  }
}
