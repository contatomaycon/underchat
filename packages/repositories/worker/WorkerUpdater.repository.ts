import * as schema from '@core/models';
import { worker, workerRuntime } from '@core/models';
import { NodePgDatabase } from 'drizzle-orm/node-postgres';
import { inject, injectable } from 'tsyringe';
import {
  type SQL,
  and,
  eq,
  exists,
  isNotNull,
  isNull,
  lte,
  or,
  sql,
} from 'drizzle-orm';
import { IUpdateWorker } from '@core/common/interfaces/IUpdateWorker';
import { currentTime } from '@core/common/functions/currentTime';
import { EWorkerStatus } from '@core/common/enums/EWorkerStatus';

export interface WorkerLifecycleUpdateGuard {
  lifecycle_operation_id?: string | null;
  container_id?: string | null;
  runtime_container_id?: string;
  runtime_generation?: number;
  runtime_session_volume_name?: string | null;
  /**
   * Reserved for control-plane reconciliation that closes an already
   * disconnected runtime without allowing that runtime to become active.
   */
  allow_disconnected_runtime?: boolean;
  server_id?: string;
  worker_type_id?: string;
  worker_status_id?: string;
  updated_at?: string | null;
  last_connection_check_at?: string | null;
  recreate_completion?: {
    operation_id: string;
    runtime_generation: number;
    mode:
      | 'replacement_runtime'
      | 'replacement_runtime_already_online'
      | 'revalidated_current_runtime';
  };
  whatsapp_provider_handoff?: {
    source_provider: 'baileys' | 'wwebjs' | 'whatsmeow';
    target_provider: 'baileys' | 'wwebjs' | 'whatsmeow';
    lifecycle_operation_id: string;
  };
}

type WorkerUpdateInput = Omit<
  Partial<typeof worker.$inferInsert>,
  'recreate_completed_at'
> & {
  recreate_completed_at?: string | SQL;
} & Record<string, unknown>;
type RecreateCompletion = NonNullable<
  WorkerLifecycleUpdateGuard['recreate_completion']
>;

@injectable()
export class WorkerUpdaterRepository {
  constructor(
    @inject('DatabaseRw') private readonly dbRw: NodePgDatabase<typeof schema>
  ) {}

  private updateInput(input: IUpdateWorker): WorkerUpdateInput {
    const inputUpdate: WorkerUpdateInput = {};

    if (input.worker_status_id) {
      inputUpdate.worker_status_id = input.worker_status_id;
    }

    if (input.worker_type_id) {
      inputUpdate.worker_type_id = input.worker_type_id;
    }

    if (input.session_storage) {
      inputUpdate.session_storage = input.session_storage;
    }

    if (input.server_id) {
      inputUpdate.server_id = input.server_id;
    }

    if (input.name) {
      inputUpdate.name = input.name;
    }

    if ('number' in input) {
      inputUpdate.number = input.number;
    }

    if ('container_id' in input) {
      inputUpdate.container_id = input.container_id;
    }

    if ('lifecycle_operation_id' in input) {
      inputUpdate.lifecycle_operation_id = input.lifecycle_operation_id;
    }

    if ('connection_date' in input) {
      inputUpdate.connection_date = input.connection_date;
    }

    if ('recreate_available_at' in input) {
      inputUpdate.recreate_available_at = input.recreate_available_at;
    }

    if (input.deleted_at) {
      inputUpdate.deleted_at = input.deleted_at;
    }

    return inputUpdate;
  }

  private nullableGuardCondition(
    value: string | null | undefined,
    presentCondition: (value: string) => SQL,
    nullCondition: SQL
  ): SQL {
    if (value) {
      return presentCondition(value);
    }

    return nullCondition;
  }

  private normalizeContainerId(
    value: string | null | undefined
  ): string | undefined {
    return value?.trim().toLowerCase();
  }

  private isDockerContainerId(value: string | undefined): value is string {
    return Boolean(value && /^[0-9a-f]{12,64}$/u.test(value));
  }

  private hasDockerContainerIds(...values: Array<string | undefined>): boolean {
    return values.every((value) => this.isDockerContainerId(value));
  }

  private matchesPhysicalContainer(
    containerId: string | undefined,
    runtimeContainerId: string | undefined
  ): boolean {
    if (!containerId || !runtimeContainerId) {
      return false;
    }

    return (
      containerId === runtimeContainerId ||
      containerId.startsWith(runtimeContainerId) ||
      runtimeContainerId.startsWith(containerId)
    );
  }

  private isRecreateCompletionWorkerStatus(
    status: string | undefined
  ): boolean {
    return (
      status === EWorkerStatus.recreating || status === EWorkerStatus.online
    );
  }

  private isRecreateTerminalStatus(status: string | undefined): boolean {
    return (
      status === EWorkerStatus.online || status === EWorkerStatus.disponible
    );
  }

  private isValidRuntimeGeneration(runtimeGeneration: number): boolean {
    return Number.isSafeInteger(runtimeGeneration) && runtimeGeneration > 0;
  }

  private isRecreateCompletionModeValid(
    completion: RecreateCompletion,
    input: IUpdateWorker,
    guard: WorkerLifecycleUpdateGuard,
    terminalWorkerStatus: string | undefined
  ): boolean {
    const controlContainerId = this.normalizeContainerId(guard.container_id);
    const runtimeContainerId = this.normalizeContainerId(
      guard.runtime_container_id
    );
    const targetContainerId = this.normalizeContainerId(input.container_id);
    const samePhysicalContainer = this.matchesPhysicalContainer(
      controlContainerId,
      runtimeContainerId
    );
    const targetsRuntimeContainer = this.matchesPhysicalContainer(
      targetContainerId,
      runtimeContainerId
    );
    const hasReplacementContainers = this.hasDockerContainerIds(
      controlContainerId,
      runtimeContainerId,
      targetContainerId
    );
    const hasCurrentRuntimeContainers = this.hasDockerContainerIds(
      controlContainerId,
      runtimeContainerId
    );

    switch (completion.mode) {
      case 'replacement_runtime':
        return (
          hasReplacementContainers &&
          targetsRuntimeContainer &&
          !samePhysicalContainer
        );

      case 'replacement_runtime_already_online':
        return (
          hasReplacementContainers &&
          targetsRuntimeContainer &&
          samePhysicalContainer &&
          this.isRecreateCompletionWorkerStatus(guard.worker_status_id)
        );

      case 'revalidated_current_runtime':
        return (
          hasCurrentRuntimeContainers &&
          samePhysicalContainer &&
          terminalWorkerStatus === EWorkerStatus.online
        );
    }
  }

  private isRecreateCompletionValid(
    input: IUpdateWorker,
    guard: WorkerLifecycleUpdateGuard,
    completion: RecreateCompletion
  ): boolean {
    const terminalWorkerStatus =
      input.worker_status_id ?? guard.worker_status_id;

    return (
      input.lifecycle_operation_id === null &&
      guard.lifecycle_operation_id === completion.operation_id &&
      guard.runtime_generation === completion.runtime_generation &&
      this.isValidRuntimeGeneration(completion.runtime_generation) &&
      this.isRecreateCompletionWorkerStatus(guard.worker_status_id) &&
      this.isRecreateTerminalStatus(terminalWorkerStatus) &&
      this.isRecreateCompletionModeValid(
        completion,
        input,
        guard,
        terminalWorkerStatus
      )
    );
  }

  private applyRecreateCompletion(
    updateInput: WorkerUpdateInput,
    completion: RecreateCompletion
  ): void {
    updateInput.recreate_completed_operation_id = completion.operation_id;
    updateInput.recreate_completed_runtime_generation =
      completion.runtime_generation;
    updateInput.recreate_completed_at = sql`clock_timestamp()`;
  }

  updateWorkerById = async (
    accountId: string,
    input: IUpdateWorker
  ): Promise<boolean> => {
    const updateInput = this.updateInput(input);

    if (Object.keys(updateInput).length === 0) {
      return false;
    }

    updateInput.updated_at = currentTime();

    const result = await this.dbRw
      .update(worker)
      .set(updateInput)
      .where(
        and(
          eq(worker.account_id, accountId),
          eq(worker.worker_id, input.worker_id)
        )
      )
      .execute();

    return result.rowCount === 1;
  };

  updateWorkerByIdIfLifecycleMatches = async (
    accountId: string,
    input: IUpdateWorker,
    guard: WorkerLifecycleUpdateGuard
  ): Promise<boolean> => {
    const updateInput = this.updateInput(input);

    if (guard.recreate_completion) {
      if (
        !this.isRecreateCompletionValid(input, guard, guard.recreate_completion)
      ) {
        return false;
      }

      this.applyRecreateCompletion(updateInput, guard.recreate_completion);
    }

    if (Object.keys(updateInput).length === 0) {
      return false;
    }

    updateInput.updated_at = currentTime();

    const conditions = [
      eq(worker.account_id, accountId),
      eq(worker.worker_id, input.worker_id),
      isNull(worker.deleted_at),
    ];

    if ('lifecycle_operation_id' in guard) {
      conditions.push(
        this.nullableGuardCondition(
          guard.lifecycle_operation_id,
          (operationId) => eq(worker.lifecycle_operation_id, operationId),
          isNull(worker.lifecycle_operation_id)
        )
      );
    }

    if ('container_id' in guard) {
      conditions.push(
        this.nullableGuardCondition(
          guard.container_id,
          (containerId) => eq(worker.container_id, containerId),
          isNull(worker.container_id)
        )
      );
    }

    if (
      guard.runtime_container_id !== undefined ||
      guard.runtime_generation !== undefined ||
      'runtime_session_volume_name' in guard
    ) {
      const runtimeConditions = [
        eq(workerRuntime.worker_id, worker.worker_id),
        // A user disconnect is a durable terminal barrier for the current
        // connection epoch. Every runtime-fenced business mutation must test
        // it in the same SQL statement so a delayed ONLINE cannot win a
        // read/check/update race with the disconnect finalizer.
        ...(guard.allow_disconnected_runtime
          ? []
          : [isNull(workerRuntime.connection_disconnected_at)]),
      ];
      if (guard.runtime_container_id !== undefined) {
        runtimeConditions.push(
          eq(workerRuntime.container_id, guard.runtime_container_id)
        );
      }
      if (guard.runtime_generation !== undefined) {
        runtimeConditions.push(
          eq(workerRuntime.runtime_generation, guard.runtime_generation)
        );
      }
      if ('runtime_session_volume_name' in guard) {
        const sessionVolumeName = guard.runtime_session_volume_name;
        if (sessionVolumeName === null) {
          runtimeConditions.push(isNull(workerRuntime.session_volume_name));
        } else if (sessionVolumeName !== undefined) {
          runtimeConditions.push(
            eq(workerRuntime.session_volume_name, sessionVolumeName)
          );
        }
      }
      conditions.push(
        exists(
          this.dbRw
            .select({ worker_id: workerRuntime.worker_id })
            .from(workerRuntime)
            .where(and(...runtimeConditions))
        )
      );
    }

    const recreateCompletion = guard.recreate_completion;
    if (
      recreateCompletion?.mode === 'replacement_runtime' ||
      recreateCompletion?.mode === 'replacement_runtime_already_online'
    ) {
      conditions.push(
        exists(
          this.dbRw
            .select({ worker_id: workerRuntime.worker_id })
            .from(workerRuntime)
            .where(
              and(
                eq(workerRuntime.worker_id, worker.worker_id),
                eq(
                  workerRuntime.recreate_bootstrap_operation_id,
                  recreateCompletion.operation_id
                ),
                eq(
                  workerRuntime.recreate_bootstrap_runtime_generation,
                  recreateCompletion.runtime_generation
                ),
                eq(
                  workerRuntime.recreate_bootstrap_container_id,
                  guard.runtime_container_id as string
                ),
                isNotNull(workerRuntime.recreate_bootstrap_started_at),
                isNull(workerRuntime.recreate_retired_operation_id),
                isNull(workerRuntime.recreate_retired_runtime_generation),
                isNull(workerRuntime.recreate_retired_container_id),
                isNull(workerRuntime.recreate_retired_at)
              )
            )
        )
      );
    }

    if (guard.server_id) {
      conditions.push(eq(worker.server_id, guard.server_id));
    }

    if (guard.worker_type_id) {
      conditions.push(eq(worker.worker_type_id, guard.worker_type_id));
    }

    if (guard.worker_status_id) {
      conditions.push(eq(worker.worker_status_id, guard.worker_status_id));
    }

    if ('updated_at' in guard) {
      conditions.push(
        this.nullableGuardCondition(
          guard.updated_at,
          (updatedAt) => eq(worker.updated_at, updatedAt),
          isNull(worker.updated_at)
        )
      );
    }

    if ('last_connection_check_at' in guard) {
      conditions.push(
        this.nullableGuardCondition(
          guard.last_connection_check_at,
          (lastConnectionCheckAt) =>
            eq(worker.last_connection_check_at, lastConnectionCheckAt),
          isNull(worker.last_connection_check_at)
        )
      );
    }

    const providerHandoff = guard.whatsapp_provider_handoff;
    const replacementCompletion = Boolean(
      recreateCompletion?.mode === 'replacement_runtime' ||
      recreateCompletion?.mode === 'replacement_runtime_already_online'
    );
    if (replacementCompletion && recreateCompletion) {
      return this.dbRw.transaction(async (transaction) => {
        await transaction.execute(sql`SET LOCAL lock_timeout = '5s'`);
        await transaction.execute(sql`SET LOCAL statement_timeout = '15s'`);

        // Recreate retirement takes the same locks in this global order. The
        // winner therefore determines the terminal state atomically: a
        // completion that locks first clears the worker lifecycle before a
        // revoke can validate it; a revoke that locks first clears the marker
        // and installs the tombstone before completion can validate runtime.
        const workerLock = await transaction.execute(sql`
          SELECT owner.worker_id::text AS worker_id,
                 owner.account_id::text AS account_id,
                 owner.deleted_at
          FROM public.worker AS owner
          WHERE owner.worker_id = ${input.worker_id}::uuid
          FOR UPDATE
        `);
        const lockedWorker = (
          workerLock as unknown as {
            rows?: Array<{
              worker_id?: string;
              account_id?: string;
              deleted_at?: string | null;
            }>;
          }
        ).rows?.[0];
        if (
          !lockedWorker ||
          lockedWorker.worker_id !== input.worker_id ||
          lockedWorker.account_id !== accountId ||
          lockedWorker.deleted_at
        ) {
          return false;
        }

        const runtimeLock = await transaction.execute(sql`
          SELECT runtime.container_id,
                 runtime.runtime_generation,
                 runtime.recreate_bootstrap_operation_id::text
                   AS recreate_bootstrap_operation_id,
                 runtime.recreate_bootstrap_runtime_generation,
                 runtime.recreate_bootstrap_container_id,
                 runtime.recreate_bootstrap_started_at,
                 runtime.recreate_retired_operation_id::text
                   AS recreate_retired_operation_id,
                 runtime.recreate_retired_runtime_generation,
                 runtime.recreate_retired_container_id,
                 runtime.recreate_retired_at
          FROM public.worker_runtime AS runtime
          WHERE runtime.worker_id = ${input.worker_id}::uuid
          FOR UPDATE
        `);
        const lockedRuntime = (
          runtimeLock as unknown as {
            rows?: Array<{
              container_id?: string | null;
              runtime_generation?: number | string;
              recreate_bootstrap_operation_id?: string | null;
              recreate_bootstrap_runtime_generation?: number | string | null;
              recreate_bootstrap_container_id?: string | null;
              recreate_bootstrap_started_at?: string | null;
              recreate_retired_operation_id?: string | null;
              recreate_retired_runtime_generation?: number | string | null;
              recreate_retired_container_id?: string | null;
              recreate_retired_at?: string | null;
            }>;
          }
        ).rows?.[0];
        const runtimeContainerId = this.normalizeContainerId(
          guard.runtime_container_id
        );
        if (
          !lockedRuntime ||
          this.normalizeContainerId(lockedRuntime.container_id) !==
            runtimeContainerId ||
          Number(lockedRuntime.runtime_generation) !==
            recreateCompletion.runtime_generation ||
          lockedRuntime.recreate_bootstrap_operation_id !==
            recreateCompletion.operation_id ||
          Number(lockedRuntime.recreate_bootstrap_runtime_generation) !==
            recreateCompletion.runtime_generation ||
          this.normalizeContainerId(
            lockedRuntime.recreate_bootstrap_container_id
          ) !== runtimeContainerId ||
          !lockedRuntime.recreate_bootstrap_started_at ||
          lockedRuntime.recreate_retired_operation_id !== null ||
          lockedRuntime.recreate_retired_runtime_generation !== null ||
          lockedRuntime.recreate_retired_container_id !== null ||
          lockedRuntime.recreate_retired_at !== null
        ) {
          return false;
        }

        const result = await transaction
          .update(worker)
          .set(updateInput)
          .where(and(...conditions))
          .execute();
        if (result.rowCount !== 1) {
          return false;
        }
        if (providerHandoff) {
          await transaction.execute(sql`
            SELECT *
            FROM public.request_whatsapp_provider_handoff(
              ${input.worker_id}::uuid,
              ${accountId}::uuid,
              ${providerHandoff.source_provider}::text,
              ${providerHandoff.target_provider}::text,
              ${providerHandoff.lifecycle_operation_id}::uuid
            )
          `);
        }
        return true;
      });
    }

    if (!providerHandoff) {
      const result = await this.dbRw
        .update(worker)
        .set(updateInput)
        .where(and(...conditions))
        .execute();

      return result.rowCount === 1;
    }

    return this.dbRw.transaction(async (transaction) => {
      const result = await transaction
        .update(worker)
        .set(updateInput)
        .where(and(...conditions))
        .execute();
      if (result.rowCount !== 1) {
        return false;
      }

      await transaction.execute(sql`
        SELECT *
        FROM public.request_whatsapp_provider_handoff(
          ${input.worker_id}::uuid,
          ${accountId}::uuid,
          ${providerHandoff.source_provider}::text,
          ${providerHandoff.target_provider}::text,
          ${providerHandoff.lifecycle_operation_id}::uuid
        )
      `);
      return true;
    });
  };

  updateWorkerByIdIfRecreateAvailable = async (
    accountId: string,
    input: IUpdateWorker,
    now: string,
    guard?: WorkerLifecycleUpdateGuard
  ): Promise<boolean> => {
    const updateInput = this.updateInput(input);

    if (Object.keys(updateInput).length === 0) {
      return false;
    }

    updateInput.updated_at = currentTime();

    const conditions = [
      eq(worker.account_id, accountId),
      eq(worker.worker_id, input.worker_id),
      or(
        isNull(worker.recreate_available_at),
        lte(worker.recreate_available_at, now)
      ),
    ];

    if (guard && 'lifecycle_operation_id' in guard) {
      conditions.push(
        this.nullableGuardCondition(
          guard.lifecycle_operation_id,
          (operationId) => eq(worker.lifecycle_operation_id, operationId),
          isNull(worker.lifecycle_operation_id)
        )
      );
    }

    if (guard?.server_id) {
      conditions.push(eq(worker.server_id, guard.server_id));
    }

    if (guard?.worker_type_id) {
      conditions.push(eq(worker.worker_type_id, guard.worker_type_id));
    }

    if (guard?.worker_status_id) {
      conditions.push(eq(worker.worker_status_id, guard.worker_status_id));
    }

    if (guard && 'updated_at' in guard) {
      conditions.push(
        this.nullableGuardCondition(
          guard.updated_at,
          (updatedAt) => eq(worker.updated_at, updatedAt),
          isNull(worker.updated_at)
        )
      );
    }

    const result = await this.dbRw
      .update(worker)
      .set(updateInput)
      .where(and(...conditions))
      .execute();

    return result.rowCount === 1;
  };
}
