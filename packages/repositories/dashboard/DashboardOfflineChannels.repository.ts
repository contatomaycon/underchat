import * as schema from '@core/models';
import {
  worker,
  workerRuntime,
  workerStatus,
  whatsappSessionLease,
} from '@core/models';
import { NodePgDatabase } from 'drizzle-orm/node-postgres';
import { inject, injectable } from 'tsyringe';
import { and, eq, isNull, asc, not, notInArray, sql } from 'drizzle-orm';
import { ListOfflineChannelsResponse } from '@core/schema/dashboard/listOfflineChannels/response.schema';
import { EWorkerStatus } from '@core/common/enums/EWorkerStatus';
import { EWorkerType } from '@core/common/enums/EWorkerType';
import {
  normalizeWhatsappConnectionStatus,
  normalizeWhatsappConnectionStatusObservedAt,
  normalizeWhatsappConnectionStatusSourceId,
  projectWhatsappChannelDisplayStatus,
  projectWhatsappConnectionPublicStatus,
} from '@core/common/functions/whatsappConnectionStatus';
import { projectWorkerRecreatePhaseProjection } from '@core/common/functions/workerRecreatePhase';
import {
  effectiveWorkerOnlinePredicate,
  liveWhatsappSessionLeaseJoinCondition,
} from '@core/repositories/worker/workerEffectiveOnline.sql';

@injectable()
export class DashboardOfflineChannelsRepository {
  constructor(
    @inject('DatabaseRw') private readonly dbRw: NodePgDatabase<typeof schema>
  ) {}

  listOfflineChannels = async (
    accountId: string
  ): Promise<ListOfflineChannelsResponse[]> => {
    const result = await this.dbRw
      .select({
        id: worker.worker_id,
        name: worker.name,
        session_identity_present: sql<boolean>`
          ${worker.number} IS NOT NULL AND btrim(${worker.number}) <> ''
        `,
        status: {
          id: workerStatus.worker_status_id,
          name: workerStatus.status,
        },
        worker_type_id: worker.worker_type_id,
        native_connection_status: workerRuntime.native_connection_public_status,
        native_connection_status_source_id:
          workerRuntime.native_connection_status_source_id,
        native_connection_status_order:
          workerRuntime.native_connection_status_outbox_id,
        native_connection_online_acknowledged: effectiveWorkerOnlinePredicate(),
        runtime_generation: workerRuntime.runtime_generation,
        lifecycle_operation_id: worker.lifecycle_operation_id,
        recreate_completed_operation_id: worker.recreate_completed_operation_id,
        recreate_completed_runtime_generation:
          worker.recreate_completed_runtime_generation,
        recreate_completed_at: worker.recreate_completed_at,
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
        worker_status_observed_at: sql<string>`${worker.updated_at}::text`,
      })
      .from(worker)
      .innerJoin(
        workerStatus,
        eq(workerStatus.worker_status_id, worker.worker_status_id)
      )
      .leftJoin(workerRuntime, eq(workerRuntime.worker_id, worker.worker_id))
      .leftJoin(whatsappSessionLease, liveWhatsappSessionLeaseJoinCondition())
      .where(
        and(
          eq(worker.account_id, accountId),
          isNull(worker.deleted_at),
          notInArray(worker.worker_status_id, [
            EWorkerStatus.deleting,
            EWorkerStatus.delete,
          ]),
          not(effectiveWorkerOnlinePredicate())
        )
      )
      .orderBy(asc(worker.name))
      .execute();

    if (!result?.length) {
      return [];
    }

    return result.flatMap((item) => {
      const provider =
        item.worker_type_id === EWorkerType.baileys
          ? 'baileys'
          : item.worker_type_id === EWorkerType.wwebjs
            ? 'wwebjs'
            : item.worker_type_id === EWorkerType.whatsmeow
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
      const publicStatus = connectionStatusSourceId
        ? projectWhatsappConnectionPublicStatus(connectionStatus)
        : undefined;
      const onlineAcknowledged =
        Boolean(connectionStatusSourceId) &&
        item.native_connection_online_acknowledged;
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
      const display = projectWhatsappChannelDisplayStatus({
        workerTypeId: item.worker_type_id,
        workerStatusId: item.status?.id,
        recreatePhase: recreatePhase?.phase,
        connectionStatus: publicStatus,
        connectionOnlineAcknowledged: onlineAcknowledged,
      });
      if (
        (display.kind === 'worker' &&
          display.workerStatusId === EWorkerStatus.online) ||
        (display.kind === 'connection' && display.connectionStatus === 'online')
      ) {
        return [];
      }
      return [
        {
          id: item.id,
          name: item.name,
          worker_type_id: item.worker_type_id,
          session_identity_present: item.session_identity_present === true,
          status: item.status
            ? {
                id: item.status.id,
                name: item.status.name,
              }
            : null,
          connection_status:
            display.kind === 'connection' ? display.connectionStatus : null,
          connection_status_source_id: connectionStatusSourceId ?? null,
          connection_status_sequence: connectionStatusSourceId
            ? (connectionStatus?.sequence ?? null)
            : null,
          connection_status_changed_at: connectionStatusSourceId
            ? (connectionStatus?.changedAt ?? null)
            : null,
          connection_status_order:
            connectionStatusSourceId && item.native_connection_status_order
              ? String(item.native_connection_status_order)
              : null,
          connection_online_acknowledged: onlineAcknowledged,
          ...(item.runtime_generation
            ? { runtime_generation: item.runtime_generation }
            : {}),
          ...(item.lifecycle_operation_id
            ? { lifecycle_operation_id: item.lifecycle_operation_id }
            : {}),
          ...(recreatePhase
            ? {
                recreate_phase: recreatePhase.phase,
                recreate_runtime_retired: recreatePhase.runtimeRetired,
                ...(recreatePhase.observedAt
                  ? {
                      recreate_phase_observed_at: recreatePhase.observedAt,
                    }
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
          connection_status_observed_at:
            normalizeWhatsappConnectionStatusObservedAt(
              item.connection_status_observed_at
            ),
          connection_disconnected_at:
            normalizeWhatsappConnectionStatusObservedAt(
              item.connection_disconnected_at
            ),
          worker_status_observed_at:
            normalizeWhatsappConnectionStatusObservedAt(
              item.worker_status_observed_at
            ),
        },
      ];
    });
  };
}
