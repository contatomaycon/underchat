import * as schema from '@core/models';
import { worker, workerRuntime } from '@core/models';
import { NodePgDatabase } from 'drizzle-orm/node-postgres';
import { inject, injectable } from 'tsyringe';
import { IWorkerMonitor } from '@core/common/interfaces/IWorkerMonitor';
import {
  and,
  asc,
  eq,
  gt,
  inArray,
  isNotNull,
  isNull,
  ne,
  sql,
} from 'drizzle-orm';
import { EWorkerStatus } from '@core/common/enums/EWorkerStatus';
import { EWorkerType } from '@core/common/enums/EWorkerType';

@injectable()
export class WorkerMonitorViewerRepository {
  constructor(
    @inject('DatabaseRo') private readonly dbRo: NodePgDatabase<typeof schema>,
    @inject('DatabaseRw')
    private readonly dbRw: NodePgDatabase<typeof schema>
  ) {}

  listWorkers = async (): Promise<IWorkerMonitor[]> => {
    const result = await this.dbRo
      .select({
        worker_id: worker.worker_id,
        name: worker.name,
        account_id: worker.account_id,
        server_id: worker.server_id,
        worker_status_id: worker.worker_status_id,
        worker_type_id: worker.worker_type_id,
        number: worker.number,
        connection_date: worker.connection_date,
        session_storage: worker.session_storage,
        created_at: worker.created_at,
        updated_at: worker.updated_at,
        deleted_at: worker.deleted_at,
        container_id: worker.container_id,
        runtime_container_id: workerRuntime.container_id,
        runtime_generation: workerRuntime.runtime_generation,
        connection_epoch: workerRuntime.connection_epoch,
        disconnected_connection_epoch:
          workerRuntime.disconnected_connection_epoch,
        connection_disconnected_at: workerRuntime.connection_disconnected_at,
        runtime_session_volume_name: workerRuntime.session_volume_name,
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
        lifecycle_operation_id: worker.lifecycle_operation_id,
        recreate_completed_operation_id: worker.recreate_completed_operation_id,
        recreate_completed_runtime_generation:
          worker.recreate_completed_runtime_generation,
        recreate_completed_at: worker.recreate_completed_at,
        last_connection_check_at: worker.last_connection_check_at,
      })
      .from(worker)
      .leftJoin(workerRuntime, eq(workerRuntime.worker_id, worker.worker_id))
      .where(
        and(
          isNull(worker.deleted_at),
          isNotNull(worker.server_id),
          ne(worker.worker_status_id, EWorkerStatus.blocked),
          ne(worker.worker_type_id, EWorkerType.whatsapp)
        )
      )
      .orderBy(sql`CASE WHEN ${worker.updated_at} IS NULL THEN 0 ELSE 1 END`)
      .execute();

    if (!result?.length) {
      return [];
    }

    return result as IWorkerMonitor[];
  };

  listLivenessLifecycleRedriveCandidates = async (
    limit = 100,
    afterWorkerId?: string
  ): Promise<IWorkerMonitor[]> => {
    const boundedLimit = Number.isFinite(limit)
      ? Math.max(1, Math.min(500, Math.floor(limit)))
      : 100;
    const filters = [
      isNull(worker.deleted_at),
      isNotNull(worker.server_id),
      isNotNull(worker.lifecycle_operation_id),
      inArray(worker.worker_status_id, [
        EWorkerStatus.creating,
        EWorkerStatus.recreating,
        EWorkerStatus.online,
        EWorkerStatus.error,
        EWorkerStatus.deleting,
        EWorkerStatus.blocked,
      ]),
      ne(worker.worker_type_id, EWorkerType.whatsapp),
      ...(afterWorkerId ? [gt(worker.worker_id, afterWorkerId)] : []),
    ];
    const result = await this.dbRw
      .select({
        worker_id: worker.worker_id,
        name: worker.name,
        account_id: worker.account_id,
        server_id: worker.server_id,
        worker_status_id: worker.worker_status_id,
        worker_type_id: worker.worker_type_id,
        number: worker.number,
        connection_date: worker.connection_date,
        session_storage: worker.session_storage,
        created_at: worker.created_at,
        updated_at: worker.updated_at,
        deleted_at: worker.deleted_at,
        container_id: worker.container_id,
        runtime_container_id: workerRuntime.container_id,
        runtime_generation: workerRuntime.runtime_generation,
        connection_epoch: workerRuntime.connection_epoch,
        disconnected_connection_epoch:
          workerRuntime.disconnected_connection_epoch,
        connection_disconnected_at: workerRuntime.connection_disconnected_at,
        runtime_session_volume_name: workerRuntime.session_volume_name,
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
        lifecycle_operation_id: worker.lifecycle_operation_id,
        recreate_completed_operation_id: worker.recreate_completed_operation_id,
        recreate_completed_runtime_generation:
          worker.recreate_completed_runtime_generation,
        recreate_completed_at: worker.recreate_completed_at,
        last_connection_check_at: worker.last_connection_check_at,
      })
      .from(worker)
      .leftJoin(workerRuntime, eq(workerRuntime.worker_id, worker.worker_id))
      .where(and(...filters))
      .orderBy(asc(worker.worker_id))
      .limit(boundedLimit)
      .execute();

    return (result ?? []) as IWorkerMonitor[];
  };

  listMissingRuntimeRecoveryCandidates = async (
    limit = 250,
    afterWorkerId?: string
  ): Promise<IWorkerMonitor[]> => {
    const boundedLimit = Number.isFinite(limit)
      ? Math.max(1, Math.min(500, Math.floor(limit)))
      : 250;
    const filters = [
      isNull(worker.deleted_at),
      isNotNull(worker.server_id),
      eq(worker.worker_status_id, EWorkerStatus.online),
      isNull(worker.lifecycle_operation_id),
      isNotNull(worker.container_id),
      isNotNull(workerRuntime.container_id),
      eq(worker.container_id, workerRuntime.container_id),
      gt(workerRuntime.runtime_generation, 0),
      ne(worker.worker_type_id, EWorkerType.whatsapp),
      ...(afterWorkerId ? [gt(worker.worker_id, afterWorkerId)] : []),
    ];
    const result = await this.dbRw
      .select({
        worker_id: worker.worker_id,
        name: worker.name,
        account_id: worker.account_id,
        server_id: worker.server_id,
        worker_status_id: worker.worker_status_id,
        worker_type_id: worker.worker_type_id,
        number: worker.number,
        connection_date: worker.connection_date,
        session_storage: worker.session_storage,
        created_at: worker.created_at,
        updated_at: worker.updated_at,
        deleted_at: worker.deleted_at,
        container_id: worker.container_id,
        runtime_container_id: workerRuntime.container_id,
        runtime_generation: workerRuntime.runtime_generation,
        connection_epoch: workerRuntime.connection_epoch,
        disconnected_connection_epoch:
          workerRuntime.disconnected_connection_epoch,
        connection_disconnected_at: workerRuntime.connection_disconnected_at,
        runtime_session_volume_name: workerRuntime.session_volume_name,
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
        lifecycle_operation_id: worker.lifecycle_operation_id,
        recreate_completed_operation_id: worker.recreate_completed_operation_id,
        recreate_completed_runtime_generation:
          worker.recreate_completed_runtime_generation,
        recreate_completed_at: worker.recreate_completed_at,
        last_connection_check_at: worker.last_connection_check_at,
      })
      .from(worker)
      .innerJoin(workerRuntime, eq(workerRuntime.worker_id, worker.worker_id))
      .where(and(...filters))
      .orderBy(asc(worker.worker_id))
      .limit(boundedLimit)
      .execute();

    return (result ?? []) as IWorkerMonitor[];
  };

  viewWorker = async (workerId: string): Promise<IWorkerMonitor | null> => {
    return this.viewWorkerFrom(this.dbRo, workerId);
  };

  viewWorkerConsistent = async (
    workerId: string
  ): Promise<IWorkerMonitor | null> => {
    return this.viewWorkerFrom(this.dbRw, workerId);
  };

  private readonly viewWorkerFrom = async (
    database: NodePgDatabase<typeof schema>,
    workerId: string
  ): Promise<IWorkerMonitor | null> => {
    const result = await database
      .select({
        worker_id: worker.worker_id,
        name: worker.name,
        account_id: worker.account_id,
        server_id: worker.server_id,
        worker_status_id: worker.worker_status_id,
        worker_type_id: worker.worker_type_id,
        number: worker.number,
        connection_date: worker.connection_date,
        session_storage: worker.session_storage,
        created_at: worker.created_at,
        updated_at: worker.updated_at,
        deleted_at: worker.deleted_at,
        container_id: worker.container_id,
        runtime_container_id: workerRuntime.container_id,
        runtime_generation: workerRuntime.runtime_generation,
        connection_epoch: workerRuntime.connection_epoch,
        disconnected_connection_epoch:
          workerRuntime.disconnected_connection_epoch,
        connection_disconnected_at: workerRuntime.connection_disconnected_at,
        runtime_session_volume_name: workerRuntime.session_volume_name,
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
        lifecycle_operation_id: worker.lifecycle_operation_id,
        recreate_completed_operation_id: worker.recreate_completed_operation_id,
        recreate_completed_runtime_generation:
          worker.recreate_completed_runtime_generation,
        recreate_completed_at: worker.recreate_completed_at,
        last_connection_check_at: worker.last_connection_check_at,
      })
      .from(worker)
      .leftJoin(workerRuntime, eq(workerRuntime.worker_id, worker.worker_id))
      .where(
        and(
          eq(worker.worker_id, workerId),
          isNotNull(worker.server_id),
          ne(worker.worker_type_id, EWorkerType.whatsapp)
        )
      )
      .execute();

    if (!result?.length) {
      return null;
    }

    return result[0] as IWorkerMonitor;
  };
}
