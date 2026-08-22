import * as schema from '@core/models';
import { worker, workerRuntime, workerStatus } from '@core/models';
import { NodePgDatabase } from 'drizzle-orm/node-postgres';
import { inject, injectable } from 'tsyringe';
import { and, eq, isNull, asc, sql } from 'drizzle-orm';
import { ListChannelsStatusResponse } from '@core/schema/dashboard/listChannelsStatus/response.schema';
import { projectWorkerRecreatePhaseProjection } from '@core/common/functions/workerRecreatePhase';
import { normalizeWhatsappConnectionStatusObservedAt } from '@core/common/functions/whatsappConnectionStatus';

@injectable()
export class DashboardChannelsStatusRepository {
  constructor(
    @inject('DatabaseRw') private readonly dbRw: NodePgDatabase<typeof schema>
  ) {}

  listChannelsStatus = async (
    accountId: string
  ): Promise<ListChannelsStatusResponse[]> => {
    const result = await this.dbRw
      .select({
        id: worker.worker_id,
        name: worker.name,
        worker_type_id: worker.worker_type_id,
        session_identity_present: sql<boolean>`
          ${worker.number} IS NOT NULL AND btrim(${worker.number}) <> ''
        `,
        status: {
          id: workerStatus.worker_status_id,
          name: workerStatus.status,
        },
        connection_status_source_id:
          workerRuntime.native_connection_status_source_id,
        connection_status_order:
          workerRuntime.native_connection_status_outbox_id,
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
      .where(and(eq(worker.account_id, accountId), isNull(worker.deleted_at)))
      .orderBy(asc(worker.name))
      .execute();

    if (!result?.length) {
      return [];
    }

    return result.map((item) => {
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
        worker_type_id: item.worker_type_id,
        session_identity_present: item.session_identity_present === true,
        status: item.status
          ? {
              id: item.status.id,
              name: item.status.name,
            }
          : null,
        connection_status_source_id: item.connection_status_source_id ?? null,
        connection_status_order: item.connection_status_order
          ? String(item.connection_status_order)
          : null,
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
        connection_disconnected_at: normalizeWhatsappConnectionStatusObservedAt(
          item.connection_disconnected_at
        ),
        worker_status_observed_at: normalizeWhatsappConnectionStatusObservedAt(
          item.worker_status_observed_at
        ),
      };
    });
  };
}
