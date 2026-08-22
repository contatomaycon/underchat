import {
  whatsappSessionLease,
  worker,
  workerRuntime,
  workerWhatsappOfficialConnection,
} from '@core/models';
import { EWorkerStatus } from '@core/common/enums/EWorkerStatus';
import { EWorkerType } from '@core/common/enums/EWorkerType';
import { SQL, sql } from 'drizzle-orm';

/**
 * Exact lease identity used by every read-side projection of a PostgreSQL
 * WhatsApp session. The five-second margin matches central expiry
 * reconciliation; outbox publication uses a larger transport margin before
 * it emits ONLINE.
 */
export function liveWhatsappSessionLeaseJoinCondition(): SQL {
  return sql`(
    ${whatsappSessionLease.session_id} = ${worker.worker_id}
    AND ${whatsappSessionLease.provider} = ${workerRuntime.source_provider}
    AND ${whatsappSessionLease.generation} = ${workerRuntime.runtime_generation}
    AND ${whatsappSessionLease.epoch} = ${workerRuntime.session_writer_epoch}
    AND ${whatsappSessionLease.owner_id} = ${workerRuntime.native_connection_status_lease_owner_id}
    AND ${whatsappSessionLease.fencing_token} = ${workerRuntime.native_connection_status_fencing_token}
    AND ${whatsappSessionLease.expires_at} > clock_timestamp() + interval '5 seconds'
  )`;
}

/**
 * Customer-visible ONLINE truth. An active lifecycle remains non-terminal even
 * when the replacement runtime has already connected; the recreate phase then
 * exposes that progress as `connecting` until the manager commits completion.
 *
 * Official WhatsApp normally follows the persisted status. As a compatibility
 * guard, an active official connection also remains operational if a legacy
 * plan-unblock projected it as `disponible`. Baileys, WWebJS and WhatsMeow
 * additionally require the exact native ONLINE snapshot centrally
 * acknowledged for the active provider and storage backend. PostgreSQL-backed
 * sessions must also own the joined live fencing lease; legacy-volume sessions
 * must not carry PostgreSQL lease proof.
 *
 * Callers must LEFT JOIN worker_runtime and whatsapp_session_lease using
 * liveWhatsappSessionLeaseJoinCondition().
 */
export function effectiveWorkerOnlinePredicate(): SQL<boolean> {
  return sql`(
    ${worker.lifecycle_operation_id} IS NULL
    AND (
      (
        ${worker.worker_type_id} = ${EWorkerType.whatsapp}
        AND ${worker.worker_status_id} = ${EWorkerStatus.disponible}
        AND EXISTS (
          SELECT 1
          FROM ${workerWhatsappOfficialConnection} official_connection
          WHERE official_connection.worker_id = ${worker.worker_id}
            AND official_connection.deleted_at IS NULL
        )
      )
      OR (
        ${worker.worker_status_id} = ${EWorkerStatus.online}
        AND (
          ${worker.worker_type_id} NOT IN (
            ${EWorkerType.baileys},
            ${EWorkerType.wwebjs},
            ${EWorkerType.whatsmeow}
          )
          OR (
            ${workerRuntime.native_connection_online_acknowledged} IS TRUE
            AND ${workerRuntime.session_storage} = ${worker.session_storage}
            AND ${workerRuntime.native_connection_status_source_id} IS NOT NULL
            AND ${workerRuntime.native_connection_status_sequence}
              BETWEEN 1 AND 9007199254740991
            AND ${workerRuntime.native_connection_status_outbox_id} > 0
            AND (
              (
                ${worker.worker_type_id} = ${EWorkerType.baileys}
                AND ${workerRuntime.source_provider} = 'baileys'
              )
              OR (
                ${worker.worker_type_id} = ${EWorkerType.wwebjs}
                AND ${workerRuntime.source_provider} = 'wwebjs'
              )
              OR (
                ${worker.worker_type_id} = ${EWorkerType.whatsmeow}
                AND ${workerRuntime.source_provider} = 'whatsmeow'
              )
            )
            AND ${workerRuntime.native_connection_status} ->> 'provider' =
              ${workerRuntime.source_provider}
            AND ${workerRuntime.native_connection_status} ->> 'status' = 'online'
            AND ${workerRuntime.native_connection_status} -> 'connected' =
              'true'::jsonb
            AND ${workerRuntime.native_connection_status} -> 'authenticated' =
              'true'::jsonb
            AND ${workerRuntime.native_connection_status} -> 'sessionValid' =
              'true'::jsonb
            AND ${workerRuntime.native_connection_status} -> 'qrAvailable' =
              'false'::jsonb
            AND ${workerRuntime.native_connection_public_status} ->> 'provider' =
              ${workerRuntime.source_provider}
            AND ${workerRuntime.native_connection_public_status} ->> 'status' =
              'online'
            AND ${workerRuntime.native_connection_public_status} -> 'connected' =
              'true'::jsonb
            AND ${workerRuntime.native_connection_public_status} ->
              'authenticated' = 'true'::jsonb
            AND ${workerRuntime.native_connection_public_status} ->
              'sessionValid' = 'true'::jsonb
            AND ${workerRuntime.native_connection_public_status} ->
              'qrAvailable' = 'false'::jsonb
            AND (
              (
                ${workerRuntime.session_storage} = 'legacy_volume'
                AND ${workerRuntime.native_connection_status_lease_owner_id} IS NULL
                AND ${workerRuntime.native_connection_status_fencing_token} IS NULL
              )
              OR (
                ${workerRuntime.session_storage} = 'postgres'
                AND ${whatsappSessionLease.session_id} IS NOT NULL
              )
            )
          )
        )
      )
    )
  )`;
}
