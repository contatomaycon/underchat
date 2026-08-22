import * as schema from '@core/models';
import {
  worker,
  workerStatus,
  workerType,
  server,
  account,
  workerRuntime,
  whatsappSessionLease,
} from '@core/models';
import { NodePgDatabase } from 'drizzle-orm/node-postgres';
import { inject, injectable } from 'tsyringe';
import { and, eq, isNull, sql } from 'drizzle-orm';
import { ViewWorkerResponse } from '@core/schema/worker/viewWorker/response.schema';
import { EWorkerType } from '@core/common/enums/EWorkerType';
import {
  normalizeWhatsappConnectionStatus,
  normalizeWhatsappConnectionStatusObservedAt,
  normalizeWhatsappConnectionStatusSourceId,
} from '@core/common/functions/whatsappConnectionStatus';
import { projectWorkerRecreatePhaseProjection } from '@core/common/functions/workerRecreatePhase';

@injectable()
export class WorkerViewerRepository {
  constructor(
    @inject('DatabaseRw') private readonly dbRw: NodePgDatabase<typeof schema>
  ) {}

  private readonly normalizeServer = (
    input?: { id: string | null; name: string | null } | null
  ): ViewWorkerResponse['server'] => {
    if (!input?.id) {
      return null;
    }

    return {
      id: input.id,
      name: input.name,
    };
  };

  viewWorker = async (
    accountId: string,
    workerId: string
  ): Promise<ViewWorkerResponse | null> => {
    const result = await this.dbRw
      .select({
        id: worker.worker_id,
        name: worker.name,
        session_storage: worker.session_storage,
        number: worker.number,
        status: {
          id: workerStatus.worker_status_id,
          name: workerStatus.status,
        },
        type: {
          id: workerType.worker_type_id,
          name: workerType.type,
        },
        server: {
          id: server.server_id,
          name: server.name,
        },
        account: {
          id: account.account_id,
          name: account.name,
        },
        connection_date: worker.connection_date,
        recreate_available_at: worker.recreate_available_at,
        lifecycle_operation_id: worker.lifecycle_operation_id,
        external_connection_revision: worker.external_connection_revision,
        recreate_completed_operation_id: worker.recreate_completed_operation_id,
        recreate_completed_runtime_generation:
          worker.recreate_completed_runtime_generation,
        recreate_completed_at: worker.recreate_completed_at,
        created_at: worker.created_at,
        updated_at: worker.updated_at,
        worker_status_observed_at: sql<string>`${worker.updated_at}::text`,
        native_connection_status: workerRuntime.native_connection_public_status,
        native_connection_status_source_id:
          workerRuntime.native_connection_status_source_id,
        native_connection_status_order:
          workerRuntime.native_connection_status_outbox_id,
        native_connection_online_acknowledged: sql<boolean>`(
          COALESCE(
            ${workerRuntime.native_connection_online_acknowledged}, false
          )
          AND ${workerRuntime.session_storage} = ${worker.session_storage}
          AND (
            ${workerRuntime.session_storage} <> 'postgres'
            OR ${whatsappSessionLease.session_id} IS NOT NULL
          )
        )`,
        runtime_generation: workerRuntime.runtime_generation,
        worker_container_id: worker.container_id,
        runtime_container_id: workerRuntime.container_id,
        recreate_bootstrap_operation_id:
          workerRuntime.recreate_bootstrap_operation_id,
        recreate_bootstrap_runtime_generation:
          workerRuntime.recreate_bootstrap_runtime_generation,
        recreate_bootstrap_container_id:
          workerRuntime.recreate_bootstrap_container_id,
        recreate_bootstrap_started_at:
          workerRuntime.recreate_bootstrap_started_at,
        recreate_retired_operation_id:
          workerRuntime.recreate_retired_operation_id,
        recreate_retired_runtime_generation:
          workerRuntime.recreate_retired_runtime_generation,
        recreate_retired_container_id:
          workerRuntime.recreate_retired_container_id,
        recreate_retired_at: workerRuntime.recreate_retired_at,
        connection_disconnected_at: workerRuntime.connection_disconnected_at,
        connection_status_observed_at: sql<string | null>`
          ${workerRuntime.native_connection_public_status} ->> 'changedAt'
        `,
      })
      .from(worker)
      .innerJoin(
        workerStatus,
        eq(workerStatus.worker_status_id, worker.worker_status_id)
      )
      .innerJoin(
        workerType,
        eq(workerType.worker_type_id, worker.worker_type_id)
      )
      .leftJoin(server, eq(server.server_id, worker.server_id))
      .innerJoin(account, eq(account.account_id, worker.account_id))
      .leftJoin(workerRuntime, eq(workerRuntime.worker_id, worker.worker_id))
      .leftJoin(
        whatsappSessionLease,
        and(
          eq(whatsappSessionLease.session_id, worker.worker_id),
          sql`${whatsappSessionLease.provider} = ${workerRuntime.source_provider}`,
          eq(whatsappSessionLease.generation, workerRuntime.runtime_generation),
          sql`${whatsappSessionLease.epoch} = ${workerRuntime.session_writer_epoch}`,
          sql`${whatsappSessionLease.owner_id} = ${workerRuntime.native_connection_status_lease_owner_id}`,
          sql`${whatsappSessionLease.fencing_token} = ${workerRuntime.native_connection_status_fencing_token}`,
          sql`${whatsappSessionLease.expires_at} > clock_timestamp() + interval '5 seconds'`
        )
      )
      .where(
        and(
          eq(account.account_id, accountId),
          eq(worker.worker_id, workerId),
          isNull(worker.deleted_at)
        )
      )
      .execute();

    if (!result?.length) {
      return null;
    }

    const item = result[0];
    const provider =
      item.type.id === EWorkerType.baileys
        ? 'baileys'
        : item.type.id === EWorkerType.wwebjs
          ? 'wwebjs'
          : item.type.id === EWorkerType.whatsmeow
            ? 'whatsmeow'
            : undefined;
    const connectionStatus = provider
      ? normalizeWhatsappConnectionStatus(
          item.native_connection_status,
          provider
        )
      : undefined;
    const connectionStatusSourceId = connectionStatus
      ? normalizeWhatsappConnectionStatusSourceId(
          item.native_connection_status_source_id
        )
      : undefined;
    const recreatePhase = projectWorkerRecreatePhaseProjection({
      workerStatusId: item.status?.id,
      lifecycleOperationId: item.lifecycle_operation_id,
      workerContainerId: item.worker_container_id,
      runtimeContainerId: item.runtime_container_id,
      runtimeGeneration: item.runtime_generation,
      bootstrapOperationId: item.recreate_bootstrap_operation_id,
      bootstrapRuntimeGeneration: item.recreate_bootstrap_runtime_generation,
      bootstrapContainerId: item.recreate_bootstrap_container_id,
      bootstrapStartedAt: item.recreate_bootstrap_started_at,
      retiredOperationId: item.recreate_retired_operation_id,
      retiredRuntimeGeneration: item.recreate_retired_runtime_generation,
      retiredContainerId: item.recreate_retired_container_id,
      retiredAt: item.recreate_retired_at,
    });
    const recreateCompletedAt = normalizeWhatsappConnectionStatusObservedAt(
      item.recreate_completed_at
    );
    const hasRecreateCompletion = Boolean(
      item.recreate_completed_operation_id &&
      item.recreate_completed_runtime_generation &&
      recreateCompletedAt
    );

    return {
      id: item.id,
      name: item.name,
      session_storage: item.session_storage,
      number: item.number,
      status: item.status,
      type: item.type,
      server: this.normalizeServer(item.server),
      account: item.account,
      connection_date: item.connection_date,
      recreate_available_at: item.recreate_available_at,
      lifecycle_operation_id: item.lifecycle_operation_id,
      external_connection_revision: item.external_connection_revision,
      created_at: item.created_at,
      updated_at: item.updated_at,
      worker_status_observed_at: normalizeWhatsappConnectionStatusObservedAt(
        item.worker_status_observed_at
      ),
      connection_status: connectionStatusSourceId ? connectionStatus : null,
      connection_status_source_id: connectionStatusSourceId ?? null,
      connection_status_order:
        connectionStatusSourceId && item.native_connection_status_order
          ? String(item.native_connection_status_order)
          : null,
      connection_online_acknowledged:
        Boolean(connectionStatusSourceId) &&
        item.native_connection_online_acknowledged,
      connection_status_observed_at:
        normalizeWhatsappConnectionStatusObservedAt(
          item.connection_status_observed_at
        ),
      connection_disconnected_at: normalizeWhatsappConnectionStatusObservedAt(
        item.connection_disconnected_at
      ),
      ...(item.runtime_generation
        ? { runtime_generation: item.runtime_generation }
        : {}),
      ...(recreatePhase
        ? {
            recreate_phase: recreatePhase.phase,
            recreate_runtime_retired: recreatePhase.runtimeRetired,
            ...(recreatePhase.observedAt
              ? { recreate_phase_observed_at: recreatePhase.observedAt }
              : {}),
          }
        : {}),
      ...(hasRecreateCompletion
        ? {
            recreate_completed_operation_id:
              item.recreate_completed_operation_id as string,
            recreate_completed_runtime_generation:
              item.recreate_completed_runtime_generation as number,
            recreate_completed_at: recreateCompletedAt as string,
          }
        : {}),
    };
  };
}
