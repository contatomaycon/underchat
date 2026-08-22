import * as schema from '@core/models';
import {
  server,
  worker,
  workerRuntime,
  workerType,
  workerWarmPool,
} from '@core/models';
import { EWorkerWarmPoolState } from '@core/common/enums/EWorkerWarmPoolState';
import { EServerStatus } from '@core/common/enums/EServerStatus';
import { EWorkerStatus } from '@core/common/enums/EWorkerStatus';
import { EWorkerSessionStorage } from '@core/common/enums/EWorkerSessionStorage';
import {
  IWorkerWarmPool,
  IWorkerWarmPoolReadyCount,
} from '@core/common/interfaces/IWorkerWarmPool';
import { ListWarmChannelsRequest } from '@core/schema/config/listWarmChannels/request.schema';
import { ListWarmChannelsResponse } from '@core/schema/config/listWarmChannels/response.schema';
import { currentTime } from '@core/common/functions/currentTime';
import { NodePgDatabase } from 'drizzle-orm/node-postgres';
import { inject, injectable } from 'tsyringe';
import {
  and,
  asc,
  count,
  desc,
  eq,
  gte,
  ilike,
  inArray,
  isNotNull,
  isNull,
  lte,
  ne,
  notExists,
  or,
  sql,
  SQL,
  SQLWrapper,
} from 'drizzle-orm';

export interface CreateWorkerWarmPoolInput {
  warm_pool_id: string;
  server_id: string;
  worker_type_id: string;
  container_id?: string | null;
  container_name?: string | null;
  session_storage?: EWorkerSessionStorage;
  session_volume_name: string | null;
  state?: EWorkerWarmPoolState;
}

export interface UpdateWorkerWarmPoolRuntimeInput {
  warm_pool_id: string;
  container_id?: string | null;
  container_name?: string | null;
  session_volume_name?: string;
  state?: EWorkerWarmPoolState;
  last_error?: string | null;
}

export interface FinalizeWarmPoolCreationInput {
  warmPoolId: string;
  serverId: string;
  workerTypeId: string;
  containerId: string;
  containerName: string;
  sessionVolumeName: string;
}

export interface BindPostgresWarmRuntimeInput {
  warmPoolId: string;
  workerId: string;
  accountId: string;
  serverId: string;
  workerTypeId: string;
  lifecycleOperationId: string | null;
  containerId: string;
  containerName: string;
  runtimeGeneration: number;
  runtimeCapabilityHash: string;
  writerEpoch: string;
}

export interface RecordWarmPoolCreationErrorInput {
  warmPoolId: string;
  serverId: string;
  workerTypeId: string;
  sessionVolumeName: string;
  error: string;
}

export interface RejectWarmPoolActivationInput {
  warmPoolId: string;
  reservedByWorkerId: string;
  error: string;
}

export interface ReleaseReservedWarmPoolHealthFenceInput {
  warmPoolId: string;
  reservedByWorkerId: string;
  expectedContainerId: string;
}

export interface FinalizeRejectedWarmPoolActivationCleanupInput {
  warmPoolId: string;
  reservedByWorkerId: string;
  expectedContainerId: string;
  sessionVolumeName: string;
  error: string;
}

export interface ExtendWarmPoolActivationReservationInput {
  warmPoolId: string;
  reservedByWorkerId: string;
  reservationExpiresAt: string;
}

export interface BeginWarmPoolActivationInput {
  warmPoolId: string;
  reservedByWorkerId: string;
  expectedContainerId: string;
}

export interface RestorePreGenerationWarmPoolActivationInput {
  warmPoolId: string;
  serverId: string;
  workerTypeId: string;
  reservedByWorkerId: string;
  expectedSourceContainerId: string;
  expectedSourceContainerName: string;
  sessionVolumeName: string;
}

export interface FailActivatingWarmPoolActivationInput {
  warmPoolId: string;
  reservedByWorkerId: string;
  expectedSourceContainerId: string;
  error: string;
}

export interface RevertAssignedWarmPoolActivationInput {
  warmPoolId: string;
  reservedByWorkerId: string;
  containerId: string;
  error: string;
}

export interface AssignWarmPoolRuntimeInput {
  warmPoolId: string;
  reservedByWorkerId: string;
  expectedContainerId: string;
  assignedContainerId: string;
  assignedContainerName: string;
}

export interface ClaimFailedWarmActivationCleanupInput {
  warmPoolId: string;
  reservedByWorkerId: string;
  accountId: string;
  serverId: string;
  workerTypeId: string;
  lifecycleOperationId: string | null;
  expectedWorkerStatusId: EWorkerStatus.creating | EWorkerStatus.recreating;
  expectedWarmState:
    EWorkerWarmPoolState.activating | EWorkerWarmPoolState.assigned;
  expectedWarmContainerId: string;
  runtimeGeneration: number;
  runtimeContainerId: string;
  sessionVolumeName: string;
  pendingError: string;
}

export interface FinalizeFailedWarmActivationCleanupInput {
  warmPoolId: string;
  reservedByWorkerId: string;
  accountId: string;
  serverId: string;
  workerTypeId: string;
  lifecycleOperationId: string | null;
  expectedWarmState:
    EWorkerWarmPoolState.activating | EWorkerWarmPoolState.assigned;
  expectedWarmContainerId: string;
  runtimeGeneration: number;
  runtimeContainerId: string;
  sessionVolumeName: string;
  tombstoneSessionVolumeName: string;
  pendingError: string;
  error: string;
}

export interface ClaimStaleDeletingWarmPoolInput {
  staleBefore: string;
  limit: number;
}

export interface ClaimWarmPoolCleanupInput {
  staleBefore: string;
  limit: number;
}

export interface StaleActivatingWarmPoolOwner {
  worker_id: string;
  account_id: string;
  server_id: string;
  worker_type_id: string;
  worker_status_id: EWorkerStatus;
  lifecycle_operation_id: string | null;
  updated_at: string | null;
  deleted_at: string | null;
}

export interface StaleActivatingWarmPoolContext {
  entry: IWorkerWarmPool;
  owner: StaleActivatingWarmPoolOwner | null;
}

export interface ListStaleActivatingWarmPoolInput {
  staleBefore: string;
  limit: number;
}

export interface ViewStaleActivatingWarmPoolInput {
  warmPoolId: string;
  staleBefore: string;
}

export interface ClaimStaleActivatingWarmPoolCleanupInput {
  warmPoolId: string;
  reservedByWorkerId: string;
  expectedSourceContainerId: string;
  expectedWarmUpdatedAt: string;
  cleanupContainerId: string;
  cleanupContainerName: string;
  sessionStorage: EWorkerSessionStorage;
  sessionVolumeName: string | null;
  expectedOwner: StaleActivatingWarmPoolOwner | null;
  lastError: string;
}

export interface ClaimDockerOrphanWarmPoolInput {
  warmPoolId: string;
  serverId: string;
  workerTypeId: string;
  containerId: string;
  containerName: string;
  sessionStorage: EWorkerSessionStorage;
  sessionVolumeName: string | null;
}

export interface ClaimUnpersistedWarmingRuntimeCleanupInput {
  warmPoolId: string;
  serverId: string;
  workerTypeId: string;
  expectedWarmUpdatedAt: string;
  containerId: string;
  containerName: string;
  sessionStorage: EWorkerSessionStorage;
  sessionVolumeName: string | null;
}

export interface WarmPoolRuntimeReferenceInput {
  warmPoolId: string;
  containerName: string;
  sessionVolumeName: string | null;
}

export interface AdoptedWarmRuntimeIdentity {
  worker_id: string;
  account_id: string;
  server_id: string;
  worker_type_id: string;
  worker_status_id: string;
  worker_container_id: string | null;
  lifecycle_operation_id: string | null;
  runtime_container_id: string;
  runtime_container_name: string | null;
  session_storage: EWorkerSessionStorage;
  session_volume_name: string | null;
  runtime_generation: number;
  warm_pool_id: string;
}

export interface ClaimWarmPoolCapacityInput {
  warmPoolId: string;
  serverId: string;
  workerTypeId: string;
  sessionVolumeName: string;
  target: number;
  retryAfter: string;
}

export interface ClaimMissingWarmPoolRuntimeInput {
  warmPoolId: string;
  expectedContainerId?: string;
  lastError?:
    | 'warm_runtime_missing_in_docker'
    | 'warm_runtime_unhealthy_in_docker'
    | 'warm_runtime_starting_timeout_in_docker'
    | 'warm_runtime_paused_in_docker'
    | 'warm_runtime_stopped_in_docker';
}

export interface ObserveStartingWarmPoolRuntimeInput {
  warmPoolId: string;
  expectedContainerId: string;
  firstObservedAtMs: number;
  restartCount: number;
}

export interface ConfirmHealthyReadyWarmPoolRuntimeInput {
  warmPoolId: string;
  expectedContainerId: string;
}

export type WarmPoolDeleteDispatchDecision =
  | 'dispatch'
  | 'missing'
  | 'deferred_server_unavailable'
  | 'protected_runtime'
  | 'server_mismatch'
  | 'state_not_deletable';

export interface PrepareWarmPoolDeleteDispatchInput {
  warmPoolId: string;
  serverId: string;
}

export interface WarmPoolDeleteDispatchTarget {
  warm_pool_id: string;
  server_id: string;
  worker_type_id: string;
  session_storage: EWorkerSessionStorage;
  container_id: string | null;
  container_name: string | null;
  session_volume_name: string | null;
}

export const LEGACY_WARM_RECLAIM_MARKER =
  'warm_legacy_reclaim_claimed_v1' as const;

export const CONVERTED_WARM_RECLAIM_MARKER =
  'warm_activation_abandoned:target_created_before_runtime' as const;

export interface LegacyWarmReclaimInput {
  warmPoolId: string;
  serverId: string;
  workerTypeId: string;
  containerId: string;
  containerName: string;
  sessionVolumeName: string;
}

export interface LegacyWarmReclaimDatabaseFence {
  assertUnreferenced(): Promise<void>;
}

export interface LegacyWarmAbsentResourcesInput {
  warmPoolId: string;
  serverId: string;
  workerTypeId: string;
  containerName: string;
  sessionVolumeName: string;
}

export interface LegacyWarmAbsentResourcesDatabaseFence {
  assertUnreferenced(): Promise<void>;
}

export interface ConvertedWarmReclaimInput {
  warmPoolId: string;
  serverId: string;
  workerTypeId: string;
  containerId: string;
  containerName: string;
  sessionVolumeName: string;
  ownerWorkerId: string;
}

export interface ConvertedWarmReclaimDatabaseFence {
  ownerMode: 'deleted' | 'replacement';
  ownerAccountId: string;
  replacementContainerId?: string;
  assertSafe(): Promise<void>;
}

export type WarmPoolDeleteDispatchResult =
  | {
      decision: 'dispatch';
      target: WarmPoolDeleteDispatchTarget;
    }
  | {
      decision: Exclude<WarmPoolDeleteDispatchDecision, 'dispatch'>;
      target: null;
    };

type WarmChannelFilters = Omit<
  ListWarmChannelsRequest,
  'current_page' | 'per_page' | 'sort_by'
>;

function boundedBatchLimit(value: number): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) {
    return 1;
  }

  return Math.max(1, Math.min(500, Math.floor(parsed)));
}

type StaleActivatingWarmPoolRow = IWorkerWarmPool & {
  owner_worker_id: string | null;
  owner_account_id: string | null;
  owner_server_id: string | null;
  owner_worker_type_id: string | null;
  owner_worker_status_id: EWorkerStatus | null;
  owner_lifecycle_operation_id: string | null;
  owner_updated_at: string | null;
  owner_deleted_at: string | null;
};

@injectable()
export class WorkerWarmPoolRepository {
  constructor(
    @inject('DatabaseRw') private readonly dbRw: NodePgDatabase<typeof schema>,
    @inject('DatabaseRo') private readonly dbRo: NodePgDatabase<typeof schema>
  ) {}

  async create(input: CreateWorkerWarmPoolInput): Promise<IWorkerWarmPool> {
    const [result] = await this.dbRw
      .insert(workerWarmPool)
      .values({
        warm_pool_id: input.warm_pool_id,
        server_id: input.server_id,
        worker_type_id: input.worker_type_id,
        container_id: input.container_id,
        container_name: input.container_name,
        session_storage:
          input.session_storage ?? EWorkerSessionStorage.postgres,
        session_volume_name: input.session_volume_name,
        state: input.state ?? EWorkerWarmPoolState.warming,
      })
      .onConflictDoNothing()
      .returning()
      .execute();

    if (result) {
      return result as IWorkerWarmPool;
    }

    /*
     * The capacity consumer may have inserted the warming claim immediately
     * before this balancer receives the gRPC request. Reading the conflict
     * fallback from the replica can therefore produce a false not-found.
     */
    const existing = await this.viewByIdConsistent(input.warm_pool_id);
    if (!existing) {
      throw new Error('Warm pool entry was not created.');
    }
    return existing;
  }

  async viewById(warmPoolId: string): Promise<IWorkerWarmPool | null> {
    const result = await this.dbRo
      .select()
      .from(workerWarmPool)
      .where(eq(workerWarmPool.warm_pool_id, warmPoolId))
      .limit(1)
      .execute();

    return (result[0] as IWorkerWarmPool | undefined) ?? null;
  }

  async viewByIdConsistent(
    warmPoolId: string
  ): Promise<IWorkerWarmPool | null> {
    const result = await this.dbRw
      .select()
      .from(workerWarmPool)
      .where(eq(workerWarmPool.warm_pool_id, warmPoolId))
      .limit(1)
      .execute();

    return (result[0] as IWorkerWarmPool | undefined) ?? null;
  }

  private mapStaleActivatingContext(
    row: StaleActivatingWarmPoolRow | undefined
  ): StaleActivatingWarmPoolContext | null {
    if (!row) {
      return null;
    }

    const {
      owner_worker_id: ownerWorkerId,
      owner_account_id: ownerAccountId,
      owner_server_id: ownerServerId,
      owner_worker_type_id: ownerWorkerTypeId,
      owner_worker_status_id: ownerWorkerStatusId,
      owner_lifecycle_operation_id: ownerLifecycleOperationId,
      owner_updated_at: ownerUpdatedAt,
      owner_deleted_at: ownerDeletedAt,
      ...entry
    } = row;
    const owner =
      ownerWorkerId &&
      ownerAccountId &&
      ownerServerId &&
      ownerWorkerTypeId &&
      ownerWorkerStatusId
        ? {
            worker_id: ownerWorkerId,
            account_id: ownerAccountId,
            server_id: ownerServerId,
            worker_type_id: ownerWorkerTypeId,
            worker_status_id: ownerWorkerStatusId,
            lifecycle_operation_id: ownerLifecycleOperationId,
            updated_at: ownerUpdatedAt,
            deleted_at: ownerDeletedAt,
          }
        : null;

    return {
      entry: entry as IWorkerWarmPool,
      owner,
    };
  }

  async listStaleActivatingForReconcile(
    input: ListStaleActivatingWarmPoolInput
  ): Promise<StaleActivatingWarmPoolContext[]> {
    const limit = boundedBatchLimit(input.limit);
    const result = await this.dbRw.execute(sql`
      SELECT
        pool."warm_pool_id",
        pool."server_id",
        pool."worker_type_id",
        pool."container_id",
        pool."container_name",
        pool."session_storage",
        pool."session_volume_name",
        pool."state",
        pool."reserved_by_worker_id",
        pool."reservation_expires_at",
        pool."last_health_at",
        pool."last_error",
        pool."created_at",
        pool."updated_at",
        owner."worker_id" AS "owner_worker_id",
        owner."account_id" AS "owner_account_id",
        owner."server_id" AS "owner_server_id",
        owner."worker_type_id" AS "owner_worker_type_id",
        owner."worker_status_id" AS "owner_worker_status_id",
        owner."lifecycle_operation_id" AS "owner_lifecycle_operation_id",
        owner."updated_at" AS "owner_updated_at",
        owner."deleted_at" AS "owner_deleted_at"
      FROM "worker_warm_pool" AS pool
      INNER JOIN "server" AS target_server
        ON target_server."server_id" = pool."server_id"
      LEFT JOIN "worker" AS owner
        ON owner."worker_id" = pool."reserved_by_worker_id"
      WHERE pool."state" = ${EWorkerWarmPoolState.activating}
        AND pool."updated_at" <= ${input.staleBefore}
        AND pool."reserved_by_worker_id" IS NOT NULL
        AND pool."container_id" IS NOT NULL
        AND target_server."deleted_at" IS NULL
        AND target_server."server_status_id" = ${EServerStatus.online}
        AND EXISTS (
          SELECT 1
          FROM "server_web" AS active_web
          WHERE active_web."server_id" = target_server."server_id"
            AND active_web."deleted_at" IS NULL
        )
        AND EXISTS (
          SELECT 1
          FROM "server_ssh" AS active_ssh
          WHERE active_ssh."server_id" = target_server."server_id"
            AND active_ssh."deleted_at" IS NULL
        )
      ORDER BY pool."updated_at" ASC, pool."warm_pool_id" ASC
      LIMIT ${limit}
      FOR UPDATE OF pool SKIP LOCKED
    `);
    const rows = (result as unknown as { rows?: StaleActivatingWarmPoolRow[] })
      .rows;

    return (rows ?? [])
      .map((row) => this.mapStaleActivatingContext(row))
      .filter(
        (context): context is StaleActivatingWarmPoolContext => context !== null
      );
  }

  async viewStaleActivatingForReconcile(
    input: ViewStaleActivatingWarmPoolInput
  ): Promise<StaleActivatingWarmPoolContext | null> {
    const result = await this.dbRw.execute(sql`
      SELECT
        pool."warm_pool_id",
        pool."server_id",
        pool."worker_type_id",
        pool."container_id",
        pool."container_name",
        pool."session_storage",
        pool."session_volume_name",
        pool."state",
        pool."reserved_by_worker_id",
        pool."reservation_expires_at",
        pool."last_health_at",
        pool."last_error",
        pool."created_at",
        pool."updated_at",
        owner."worker_id" AS "owner_worker_id",
        owner."account_id" AS "owner_account_id",
        owner."server_id" AS "owner_server_id",
        owner."worker_type_id" AS "owner_worker_type_id",
        owner."worker_status_id" AS "owner_worker_status_id",
        owner."lifecycle_operation_id" AS "owner_lifecycle_operation_id",
        owner."updated_at" AS "owner_updated_at",
        owner."deleted_at" AS "owner_deleted_at"
      FROM "worker_warm_pool" AS pool
      INNER JOIN "server" AS target_server
        ON target_server."server_id" = pool."server_id"
      LEFT JOIN "worker" AS owner
        ON owner."worker_id" = pool."reserved_by_worker_id"
      WHERE pool."warm_pool_id" = ${input.warmPoolId}
        AND pool."state" = ${EWorkerWarmPoolState.activating}
        AND pool."updated_at" <= ${input.staleBefore}
        AND pool."reserved_by_worker_id" IS NOT NULL
        AND pool."container_id" IS NOT NULL
        AND target_server."deleted_at" IS NULL
        AND target_server."server_status_id" = ${EServerStatus.online}
        AND EXISTS (
          SELECT 1
          FROM "server_web" AS active_web
          WHERE active_web."server_id" = target_server."server_id"
            AND active_web."deleted_at" IS NULL
        )
        AND EXISTS (
          SELECT 1
          FROM "server_ssh" AS active_ssh
          WHERE active_ssh."server_id" = target_server."server_id"
            AND active_ssh."deleted_at" IS NULL
        )
      LIMIT 1
    `);
    const rows = (result as unknown as { rows?: StaleActivatingWarmPoolRow[] })
      .rows;

    return this.mapStaleActivatingContext(rows?.[0]);
  }

  async countReadyByServerAndType(
    serverId: string,
    workerTypeId: string
  ): Promise<number> {
    const [result] = await this.dbRo
      .select({ value: count(workerWarmPool.warm_pool_id) })
      .from(workerWarmPool)
      .where(
        and(
          eq(workerWarmPool.server_id, serverId),
          eq(workerWarmPool.worker_type_id, workerTypeId),
          eq(workerWarmPool.session_storage, EWorkerSessionStorage.postgres),
          isNull(workerWarmPool.session_volume_name),
          eq(workerWarmPool.state, EWorkerWarmPoolState.ready)
        )
      )
      .execute();

    return Number(result?.value ?? 0);
  }

  private readonly buildWarmChannelTextFilter = (
    query: Partial<WarmChannelFilters>
  ): SQLWrapper | undefined => {
    const filters: SQL[] = [];

    if (query.warm_pool_id) {
      filters.push(
        ilike(workerWarmPool.warm_pool_id, `%${query.warm_pool_id}%`)
      );
    }
    if (query.container_id) {
      filters.push(
        ilike(workerWarmPool.container_id, `%${query.container_id}%`)
      );
    }
    if (query.container_name) {
      filters.push(
        ilike(workerWarmPool.container_name, `%${query.container_name}%`)
      );
    }
    if (query.session_volume_name) {
      filters.push(
        ilike(
          workerWarmPool.session_volume_name,
          `%${query.session_volume_name}%`
        )
      );
    }
    if (query.search) {
      const search = `%${query.search}%`;
      filters.push(
        or(
          ilike(workerWarmPool.warm_pool_id, search),
          ilike(workerWarmPool.container_id, search),
          ilike(workerWarmPool.container_name, search),
          ilike(workerWarmPool.session_volume_name, search),
          ilike(server.name, search),
          ilike(workerType.type, search)
        ) as SQL
      );
    }

    if (!filters.length) {
      return undefined;
    }

    return and(...filters);
  };

  private readonly setReadyWarmChannelFilters = (
    query: Partial<WarmChannelFilters>
  ): SQLWrapper[] => {
    const filters: SQLWrapper[] = [
      eq(workerWarmPool.state, EWorkerWarmPoolState.ready),
      eq(workerWarmPool.session_storage, EWorkerSessionStorage.postgres),
      isNull(workerWarmPool.session_volume_name),
      isNull(server.deleted_at),
      sql`EXISTS (
        SELECT 1
        FROM "server_web" AS active_web
        WHERE active_web."server_id" = ${workerWarmPool.server_id}
          AND active_web."deleted_at" IS NULL
      )`,
    ];

    if (query.server_id) {
      filters.push(eq(workerWarmPool.server_id, query.server_id));
    }
    if (query.type) {
      filters.push(eq(workerWarmPool.worker_type_id, query.type));
    }
    if (query.created_at_from) {
      filters.push(gte(workerWarmPool.created_at, query.created_at_from));
    }
    if (query.created_at_to) {
      filters.push(lte(workerWarmPool.created_at, query.created_at_to));
    }
    if (query.updated_at_from) {
      filters.push(gte(workerWarmPool.updated_at, query.updated_at_from));
    }
    if (query.updated_at_to) {
      filters.push(lte(workerWarmPool.updated_at, query.updated_at_to));
    }
    if (query.last_health_at_from) {
      filters.push(
        gte(workerWarmPool.last_health_at, query.last_health_at_from)
      );
    }
    if (query.last_health_at_to) {
      filters.push(lte(workerWarmPool.last_health_at, query.last_health_at_to));
    }

    const textFilter = this.buildWarmChannelTextFilter(query);
    if (textFilter) {
      filters.push(textFilter);
    }

    return filters;
  };

  private readonly setReadyWarmChannelOrders = (
    query: Pick<ListWarmChannelsRequest, 'sort_by'>
  ): SQL[] => {
    const mapping: Record<string, SQLWrapper> = {
      warm_pool_id: workerWarmPool.warm_pool_id,
      server: server.name,
      type: workerType.type,
      state: workerWarmPool.state,
      container_id: workerWarmPool.container_id,
      container_name: workerWarmPool.container_name,
      session_volume_name: workerWarmPool.session_volume_name,
      last_health_at: workerWarmPool.last_health_at,
      created_at: workerWarmPool.created_at,
      updated_at: workerWarmPool.updated_at,
    };

    const orders: SQL[] = [];

    for (const sort of query.sort_by ?? []) {
      const column = mapping[sort.key];
      if (!column) continue;

      orders.push(sort.order === 'asc' ? asc(column) : desc(column));
    }

    return orders;
  };

  async listReadyWarmChannels(
    perPage: number,
    currentPage: number,
    query: ListWarmChannelsRequest
  ): Promise<ListWarmChannelsResponse[]> {
    const filters = this.setReadyWarmChannelFilters(query);
    const orders = this.setReadyWarmChannelOrders(query);

    const queryBuilder = this.dbRo
      .select({
        warm_pool_id: workerWarmPool.warm_pool_id,
        server: {
          id: server.server_id,
          name: server.name,
        },
        type: {
          id: workerType.worker_type_id,
          name: workerType.type,
        },
        state: workerWarmPool.state,
        container_id: workerWarmPool.container_id,
        container_name: workerWarmPool.container_name,
        session_storage: workerWarmPool.session_storage,
        session_volume_name: workerWarmPool.session_volume_name,
        last_health_at: workerWarmPool.last_health_at,
        last_error: workerWarmPool.last_error,
        created_at: workerWarmPool.created_at,
        updated_at: workerWarmPool.updated_at,
      })
      .from(workerWarmPool)
      .innerJoin(server, eq(server.server_id, workerWarmPool.server_id))
      .innerJoin(
        workerType,
        eq(workerType.worker_type_id, workerWarmPool.worker_type_id)
      )
      .where(and(...filters));

    if (orders.length) {
      queryBuilder.orderBy(...orders);
    } else {
      queryBuilder.orderBy(
        asc(server.name),
        asc(workerType.type),
        desc(workerWarmPool.last_health_at)
      );
    }

    const result = await queryBuilder
      .limit(perPage)
      .offset((currentPage - 1) * perPage)
      .execute();

    return result as ListWarmChannelsResponse[];
  }

  async listReadyWarmChannelsTotal(
    query: Partial<WarmChannelFilters>
  ): Promise<number> {
    const filters = this.setReadyWarmChannelFilters(query);
    const [result] = await this.dbRo
      .select({ value: count(workerWarmPool.warm_pool_id) })
      .from(workerWarmPool)
      .innerJoin(server, eq(server.server_id, workerWarmPool.server_id))
      .innerJoin(
        workerType,
        eq(workerType.worker_type_id, workerWarmPool.worker_type_id)
      )
      .where(and(...filters))
      .execute();

    return Number(result?.value ?? 0);
  }

  async listReadyWarmChannelsForRecreate(
    query: Partial<WarmChannelFilters>
  ): Promise<IWorkerWarmPool[]> {
    const filters = this.setReadyWarmChannelFilters(query);
    const result = await this.dbRo
      .select({
        warm_pool_id: workerWarmPool.warm_pool_id,
        server_id: workerWarmPool.server_id,
        worker_type_id: workerWarmPool.worker_type_id,
        container_id: workerWarmPool.container_id,
        container_name: workerWarmPool.container_name,
        session_storage: workerWarmPool.session_storage,
        session_volume_name: workerWarmPool.session_volume_name,
        state: workerWarmPool.state,
        reserved_by_worker_id: workerWarmPool.reserved_by_worker_id,
        reservation_expires_at: workerWarmPool.reservation_expires_at,
        last_health_at: workerWarmPool.last_health_at,
        last_error: workerWarmPool.last_error,
        created_at: workerWarmPool.created_at,
        updated_at: workerWarmPool.updated_at,
      })
      .from(workerWarmPool)
      .innerJoin(server, eq(server.server_id, workerWarmPool.server_id))
      .innerJoin(
        workerType,
        eq(workerType.worker_type_id, workerWarmPool.worker_type_id)
      )
      .where(and(...filters))
      .execute();

    return result as IWorkerWarmPool[];
  }

  async claimReadyForManualRecreate(
    warmPoolId: string
  ): Promise<IWorkerWarmPool | null> {
    const now = currentTime();
    const result = await this.dbRw.execute(sql`
      UPDATE "worker_warm_pool" AS pool
      SET
        "state" = ${EWorkerWarmPoolState.deleting},
        "last_error" = 'warm_manual_recreate',
        "updated_at" = ${now}
      WHERE pool."warm_pool_id" = ${warmPoolId}
        AND pool."session_storage" = ${EWorkerSessionStorage.postgres}
        AND pool."session_volume_name" IS NULL
        AND pool."state" = ${EWorkerWarmPoolState.ready}
        AND NOT EXISTS (
          SELECT 1
          FROM "worker_runtime" AS runtime
          WHERE runtime."warm_pool_id" = pool."warm_pool_id"
            OR (
              pool."container_id" IS NOT NULL
              AND runtime."container_id" = pool."container_id"
            )
            OR (
              pool."container_name" IS NOT NULL
              AND runtime."container_name" = pool."container_name"
            )
            OR runtime."session_volume_name" = pool."session_volume_name"
        )
      RETURNING
        pool."warm_pool_id",
        pool."server_id",
        pool."worker_type_id",
        pool."container_id",
        pool."container_name",
        pool."session_storage",
        pool."session_volume_name",
        pool."state",
        pool."reserved_by_worker_id",
        pool."reservation_expires_at",
        pool."last_health_at",
        pool."last_error",
        pool."created_at",
        pool."updated_at"
    `);

    const rows = (result as unknown as { rows?: IWorkerWarmPool[] }).rows;
    return rows?.[0] ?? null;
  }

  async listActiveByServer(serverId: string): Promise<IWorkerWarmPool[]> {
    const result = await this.dbRo
      .select()
      .from(workerWarmPool)
      .where(
        and(
          eq(workerWarmPool.server_id, serverId),
          eq(workerWarmPool.session_storage, EWorkerSessionStorage.postgres),
          isNull(workerWarmPool.session_volume_name),
          inArray(workerWarmPool.state, [
            EWorkerWarmPoolState.warming,
            EWorkerWarmPoolState.ready,
            EWorkerWarmPoolState.reserved,
            EWorkerWarmPoolState.activating,
          ])
        )
      )
      .execute();

    return result as IWorkerWarmPool[];
  }

  async listPhysicalOwnershipIdsByServer(serverId: string): Promise<string[]> {
    /*
     * Read every surviving warm row from the primary, including deleting,
     * error and assigned states. Mutable state is not an ownership fence: a
     * physical ambiguity that still has a durable row remains under that
     * row's cleanup/activation state machine and must not trigger a parallel
     * replacement until the authoritative row is actually removed.
     */
    const result = await this.dbRw
      .select({ warm_pool_id: workerWarmPool.warm_pool_id })
      .from(workerWarmPool)
      .where(eq(workerWarmPool.server_id, serverId))
      .execute();

    return result.map((item) => item.warm_pool_id);
  }

  async listCapacityOwnershipIdsByServer(serverId: string): Promise<string[]> {
    /*
     * A physical standby remains capacity while it is being created, probed,
     * reserved or activated. Terminal/error/deleting rows are cleanup debt,
     * never usable capacity; excluding them lets the target heal while their
     * exact identities continue through the independent durable delete path.
     */
    const result = await this.dbRw
      .select({ warm_pool_id: workerWarmPool.warm_pool_id })
      .from(workerWarmPool)
      .where(
        and(
          eq(workerWarmPool.server_id, serverId),
          eq(workerWarmPool.session_storage, EWorkerSessionStorage.postgres),
          isNull(workerWarmPool.session_volume_name),
          inArray(workerWarmPool.state, [
            EWorkerWarmPoolState.warming,
            EWorkerWarmPoolState.ready,
            EWorkerWarmPoolState.reserved,
            EWorkerWarmPoolState.activating,
          ])
        )
      )
      .execute();

    return result.map((item) => item.warm_pool_id);
  }

  async listReadyCounts(): Promise<IWorkerWarmPoolReadyCount[]> {
    const result = await this.dbRo
      .select({
        server_id: workerWarmPool.server_id,
        worker_type_id: workerWarmPool.worker_type_id,
        ready_count: count(workerWarmPool.warm_pool_id),
      })
      .from(workerWarmPool)
      .innerJoin(server, eq(server.server_id, workerWarmPool.server_id))
      .where(
        and(
          eq(workerWarmPool.state, EWorkerWarmPoolState.ready),
          eq(workerWarmPool.session_storage, EWorkerSessionStorage.postgres),
          isNull(workerWarmPool.session_volume_name),
          isNull(server.deleted_at),
          sql`EXISTS (
            SELECT 1
            FROM "server_web" AS active_web
            WHERE active_web."server_id" = ${workerWarmPool.server_id}
              AND active_web."deleted_at" IS NULL
          )`
        )
      )
      .groupBy(workerWarmPool.server_id, workerWarmPool.worker_type_id)
      .execute();

    return result.map((item) => ({
      server_id: item.server_id,
      worker_type_id: item.worker_type_id,
      ready_count: Number(item.ready_count),
    }));
  }

  async claimStaleDeletingForRetry(
    input: ClaimStaleDeletingWarmPoolInput
  ): Promise<IWorkerWarmPool[]> {
    const limit = boundedBatchLimit(input.limit);
    const now = currentTime();
    const result = await this.dbRw.execute(sql`
      WITH selected AS (
        SELECT "warm_pool_id"
        FROM "worker_warm_pool"
        WHERE "state" = ${EWorkerWarmPoolState.deleting}
          AND "updated_at" <= ${input.staleBefore}
          AND EXISTS (
            SELECT 1
            FROM "server" AS active_server
            WHERE active_server."server_id" =
                "worker_warm_pool"."server_id"
              AND active_server."deleted_at" IS NULL
              AND EXISTS (
                SELECT 1
                FROM "server_web" AS active_web
                WHERE active_web."server_id" = active_server."server_id"
                  AND active_web."deleted_at" IS NULL
              )
          )
          AND NOT EXISTS (
            SELECT 1
            FROM "worker_runtime"
            WHERE "worker_runtime"."warm_pool_id" =
                "worker_warm_pool"."warm_pool_id"
              OR (
                "worker_warm_pool"."container_id" IS NOT NULL
                AND "worker_runtime"."container_id" =
                  "worker_warm_pool"."container_id"
              )
              OR (
                "worker_warm_pool"."container_name" IS NOT NULL
                AND "worker_runtime"."container_name" =
                  "worker_warm_pool"."container_name"
              )
              OR "worker_runtime"."session_volume_name" =
                "worker_warm_pool"."session_volume_name"
          )
        ORDER BY "updated_at" ASC, "warm_pool_id" ASC
        LIMIT ${limit}
        FOR UPDATE SKIP LOCKED
      )
      UPDATE "worker_warm_pool"
      SET
        "updated_at" = ${now},
        "last_error" = COALESCE("worker_warm_pool"."last_error", 'warm_delete_retry')
      FROM selected
      WHERE "worker_warm_pool"."warm_pool_id" = selected."warm_pool_id"
        AND "worker_warm_pool"."state" = ${EWorkerWarmPoolState.deleting}
        AND NOT EXISTS (
          SELECT 1
          FROM "worker_runtime"
          WHERE "worker_runtime"."warm_pool_id" =
              "worker_warm_pool"."warm_pool_id"
            OR (
              "worker_warm_pool"."container_id" IS NOT NULL
              AND "worker_runtime"."container_id" =
                "worker_warm_pool"."container_id"
            )
            OR (
              "worker_warm_pool"."container_name" IS NOT NULL
              AND "worker_runtime"."container_name" =
                "worker_warm_pool"."container_name"
            )
            OR "worker_runtime"."session_volume_name" =
              "worker_warm_pool"."session_volume_name"
        )
      RETURNING
        "worker_warm_pool"."warm_pool_id",
        "worker_warm_pool"."server_id",
        "worker_warm_pool"."worker_type_id",
        "worker_warm_pool"."container_id",
        "worker_warm_pool"."container_name",
        "worker_warm_pool"."session_storage",
        "worker_warm_pool"."session_volume_name",
        "worker_warm_pool"."state",
        "worker_warm_pool"."reserved_by_worker_id",
        "worker_warm_pool"."reservation_expires_at",
        "worker_warm_pool"."last_health_at",
        "worker_warm_pool"."last_error",
        "worker_warm_pool"."created_at",
        "worker_warm_pool"."updated_at"
    `);

    const rows = (result as unknown as { rows?: IWorkerWarmPool[] }).rows;
    return rows ?? [];
  }

  async listDeletingRuntimeLineageIds(limit: number): Promise<string[]> {
    const boundedLimit = boundedBatchLimit(limit);
    const result = await this.dbRw.execute(sql`
      SELECT pool."warm_pool_id"
      FROM "worker_warm_pool" AS pool
      WHERE pool."state" = ${EWorkerWarmPoolState.deleting}
        AND EXISTS (
          SELECT 1
          FROM "worker_runtime" AS runtime
          WHERE runtime."warm_pool_id" = pool."warm_pool_id"
            OR (
              pool."container_id" IS NOT NULL
              AND runtime."container_id" = pool."container_id"
            )
            OR (
              pool."container_name" IS NOT NULL
              AND runtime."container_name" = pool."container_name"
            )
            OR runtime."session_volume_name" = pool."session_volume_name"
        )
      ORDER BY pool."updated_at" ASC NULLS FIRST, pool."warm_pool_id" ASC
      LIMIT ${boundedLimit}
    `);

    const rows = (
      result as unknown as { rows?: Array<{ warm_pool_id: string }> }
    ).rows;
    return rows?.map((row) => row.warm_pool_id) ?? [];
  }

  async tombstoneUnreferencedDecommissionedServerEntries(
    limit: number
  ): Promise<number> {
    const boundedLimit = boundedBatchLimit(limit);
    const now = currentTime();
    const result = await this.dbRw.execute(sql`
      WITH selected AS (
        SELECT pool."warm_pool_id"
        FROM "worker_warm_pool" AS pool
        LEFT JOIN "server" AS target_server
          ON target_server."server_id" = pool."server_id"
        WHERE (
            target_server."server_id" IS NULL
            OR target_server."deleted_at" IS NOT NULL
            OR NOT EXISTS (
              SELECT 1
              FROM "server_web" AS active_web
              WHERE active_web."server_id" = target_server."server_id"
                AND active_web."deleted_at" IS NULL
            )
            OR NOT EXISTS (
              SELECT 1
              FROM "server_ssh" AS active_ssh
              WHERE active_ssh."server_id" = target_server."server_id"
                AND active_ssh."deleted_at" IS NULL
            )
          )
          AND NOT EXISTS (
            SELECT 1
            FROM "worker_runtime" AS runtime
            WHERE runtime."warm_pool_id" = pool."warm_pool_id"
              OR (
                pool."container_id" IS NOT NULL
                AND runtime."container_id" = pool."container_id"
              )
              OR (
                pool."container_name" IS NOT NULL
                AND runtime."container_name" = pool."container_name"
              )
              OR runtime."session_volume_name" = pool."session_volume_name"
          )
          AND NOT EXISTS (
            SELECT 1
            FROM "whatsapp_session_storage_migration" AS migration
            WHERE migration."source_volume_name" =
              pool."session_volume_name"
              AND migration."source_volume_preserved" = true
              AND migration."state" <> 'completed'
          )
          AND NOT (
            pool."state" = ${EWorkerWarmPoolState.deleting}
            AND pool."last_error" =
              'warm_server_decommissioned_cleanup_pending'
          )
        ORDER BY pool."updated_at" ASC, pool."warm_pool_id" ASC
        LIMIT ${boundedLimit}
        FOR UPDATE OF pool SKIP LOCKED
      )
      UPDATE "worker_warm_pool" AS pool
      SET
        "state" = ${EWorkerWarmPoolState.deleting},
        "container_name" = COALESCE(
          pool."container_name",
          concat('warm-', pool."warm_pool_id"::text)
        ),
        "last_error" = 'warm_server_decommissioned_cleanup_pending',
        "updated_at" = ${now}
      FROM selected
      WHERE pool."warm_pool_id" = selected."warm_pool_id"
      RETURNING pool."warm_pool_id"
    `);

    const rows = (
      result as unknown as { rows?: Array<{ warm_pool_id: string }> }
    ).rows;
    return rows?.length ?? 0;
  }

  async prepareDeleteDispatch(
    input: PrepareWarmPoolDeleteDispatchInput
  ): Promise<WarmPoolDeleteDispatchResult> {
    const now = currentTime();
    const result = await this.dbRw.execute(sql`
      WITH target AS MATERIALIZED (
        SELECT
          pool."warm_pool_id",
          pool."server_id",
          pool."worker_type_id",
          pool."session_storage",
          pool."container_id",
          pool."container_name",
          pool."session_volume_name",
          pool."state",
          (
            target_server."server_id" IS NULL
            OR target_server."deleted_at" IS NOT NULL
            OR NOT EXISTS (
              SELECT 1
              FROM "server_web" AS active_web
              WHERE active_web."server_id" = target_server."server_id"
                AND active_web."deleted_at" IS NULL
            )
            OR NOT EXISTS (
              SELECT 1
              FROM "server_ssh" AS active_ssh
              WHERE active_ssh."server_id" = target_server."server_id"
                AND active_ssh."deleted_at" IS NULL
            )
          ) AS "server_unavailable",
          EXISTS (
            SELECT 1
            FROM "worker_runtime" AS runtime
            WHERE runtime."warm_pool_id" = pool."warm_pool_id"
              OR (
                pool."container_id" IS NOT NULL
                AND runtime."container_id" = pool."container_id"
              )
              OR (
                pool."container_name" IS NOT NULL
                AND runtime."container_name" = pool."container_name"
              )
              OR runtime."session_volume_name" = pool."session_volume_name"
          ) AS "runtime_active"
        FROM "worker_warm_pool" AS pool
        LEFT JOIN "server" AS target_server
          ON target_server."server_id" = pool."server_id"
        WHERE pool."warm_pool_id" = ${input.warmPoolId}
        FOR UPDATE OF pool
      ),
      claimed AS (
        UPDATE "worker_warm_pool" AS pool
        SET
          "state" = ${EWorkerWarmPoolState.deleting},
          "updated_at" = ${now}
        FROM target
        WHERE pool."warm_pool_id" = target."warm_pool_id"
          AND target."server_id" = ${input.serverId}
          AND target."server_unavailable" = FALSE
          AND target."runtime_active" = FALSE
          AND target."state" = ${EWorkerWarmPoolState.deleting}
        RETURNING
          pool."warm_pool_id",
          pool."server_id",
          pool."worker_type_id",
          pool."session_storage",
          pool."container_id",
          pool."container_name",
          pool."session_volume_name"
      )
      SELECT
        CASE
          WHEN NOT EXISTS (SELECT 1 FROM target)
            THEN 'missing'
          WHEN (SELECT "server_unavailable" FROM target)
            THEN 'deferred_server_unavailable'
          WHEN (SELECT "runtime_active" FROM target)
            THEN 'protected_runtime'
          WHEN (SELECT "server_id" FROM target) <> ${input.serverId}
            THEN 'server_mismatch'
          WHEN EXISTS (SELECT 1 FROM claimed)
            THEN 'dispatch'
          ELSE 'state_not_deletable'
        END AS "decision",
        (SELECT "warm_pool_id" FROM claimed) AS "warm_pool_id",
        (SELECT "server_id" FROM claimed) AS "server_id",
        (SELECT "worker_type_id" FROM claimed) AS "worker_type_id",
        (SELECT "session_storage" FROM claimed) AS "session_storage",
        (SELECT "container_id" FROM claimed) AS "container_id",
        (SELECT "container_name" FROM claimed) AS "container_name",
        (SELECT "session_volume_name" FROM claimed) AS "session_volume_name"
    `);

    const rows = (
      result as unknown as {
        rows?: Array<
          {
            decision: WarmPoolDeleteDispatchDecision;
          } & Partial<WarmPoolDeleteDispatchTarget>
        >;
      }
    ).rows;
    const row = rows?.[0];
    if (!row) {
      return {
        decision: 'missing',
        target: null,
      };
    }
    if (row.decision !== 'dispatch') {
      return {
        decision: row.decision,
        target: null,
      };
    }

    if (
      !row.warm_pool_id ||
      !row.server_id ||
      !row.worker_type_id ||
      !row.session_storage ||
      ![
        EWorkerSessionStorage.legacy_volume,
        EWorkerSessionStorage.postgres,
      ].includes(row.session_storage) ||
      (row.session_storage === EWorkerSessionStorage.legacy_volume &&
        !row.session_volume_name) ||
      (row.session_storage === EWorkerSessionStorage.postgres &&
        row.session_volume_name !== null)
    ) {
      throw new Error('warm_delete_dispatch_canonical_target_missing');
    }

    return {
      decision: 'dispatch',
      target: {
        warm_pool_id: row.warm_pool_id,
        server_id: row.server_id,
        worker_type_id: row.worker_type_id,
        session_storage: row.session_storage,
        container_id: row.container_id ?? null,
        container_name: row.container_name ?? null,
        session_volume_name: row.session_volume_name ?? null,
      },
    };
  }

  /**
   * Converts a label-proven legacy standby into durable cleanup identity. The
   * row lock and negative ownership predicates make this a fail-closed CAS:
   * a warm-looking volume name alone is never sufficient ownership evidence.
   */
  async claimLegacyDeletingContainerForReclaim(
    input: LegacyWarmReclaimInput
  ): Promise<IWorkerWarmPool | null> {
    const now = currentTime();
    const result = await this.dbRw.execute(sql`
      WITH target AS MATERIALIZED (
        SELECT
          pool."warm_pool_id",
          pool."server_id",
          pool."worker_type_id",
          pool."container_id",
          pool."container_name",
          pool."session_volume_name",
          pool."state",
          pool."reserved_by_worker_id",
          pool."last_error"
        FROM "worker_warm_pool" AS pool
        WHERE pool."warm_pool_id" = ${input.warmPoolId}
        FOR UPDATE OF pool
      ),
      claimed AS (
        UPDATE "worker_warm_pool" AS pool
        SET
          "container_id" = ${input.containerId},
          "container_name" = ${input.containerName},
          "last_error" = ${LEGACY_WARM_RECLAIM_MARKER},
          "updated_at" = ${now}
        FROM target
        WHERE pool."warm_pool_id" = target."warm_pool_id"
          AND target."state" = ${EWorkerWarmPoolState.deleting}
          AND target."server_id" = ${input.serverId}
          AND target."worker_type_id" = ${input.workerTypeId}
          AND target."session_volume_name" = ${input.sessionVolumeName}
          AND target."reserved_by_worker_id" IS NULL
          AND (
            (
              target."container_id" IS NULL
              AND target."container_name" IS NULL
            )
            OR (
              target."container_id" = ${input.containerId}
              AND target."container_name" = ${input.containerName}
              AND target."last_error" LIKE
                ${`${LEGACY_WARM_RECLAIM_MARKER}%`}
            )
          )
          AND NOT EXISTS (
            SELECT 1
            FROM "worker_runtime" AS runtime
            WHERE runtime."warm_pool_id" = target."warm_pool_id"
              OR runtime."container_id" = ${input.containerId}
              OR runtime."container_name" = ${input.containerName}
              OR runtime."session_volume_name" =
                target."session_volume_name"
          )
          AND NOT EXISTS (
            SELECT 1
            FROM "worker" AS owner
            WHERE owner."container_id" = ${input.containerId}
          )
          AND NOT EXISTS (
            SELECT 1
            FROM "worker_warm_pool" AS other_pool
            WHERE other_pool."warm_pool_id" <> target."warm_pool_id"
              AND (
                other_pool."container_id" = ${input.containerId}
                OR other_pool."container_name" = ${input.containerName}
                OR other_pool."session_volume_name" =
                  target."session_volume_name"
              )
          )
          AND NOT EXISTS (
            SELECT 1
            FROM "whatsapp_session_storage_migration" AS migration
            WHERE migration."source_volume_name" =
              target."session_volume_name"
              AND migration."source_volume_preserved" = true
              AND migration."state" <> 'completed'
          )
        RETURNING pool.*
      )
      SELECT * FROM claimed
    `);
    const rows = (result as unknown as { rows?: IWorkerWarmPool[] }).rows;
    return rows?.[0] ?? null;
  }

  /**
   * Keeps the deleting row locked for the complete physical reclaim. The
   * callback can re-run the primary-database proof immediately before a
   * destructive Docker step; completion deletes only the exact claimed row.
   */
  async withLegacyDeletingReclaimFence<T>(
    input: LegacyWarmReclaimInput,
    operation: (fence: LegacyWarmReclaimDatabaseFence) => Promise<T>
  ): Promise<T | null> {
    return this.dbRw.transaction(async (tx) => {
      const locked = await tx.execute(sql`
        SELECT pool.*
        FROM "worker_warm_pool" AS pool
        WHERE pool."warm_pool_id" = ${input.warmPoolId}
          AND pool."state" = ${EWorkerWarmPoolState.deleting}
          AND pool."server_id" = ${input.serverId}
          AND pool."worker_type_id" = ${input.workerTypeId}
          AND pool."container_id" = ${input.containerId}
          AND pool."container_name" = ${input.containerName}
          AND pool."session_volume_name" = ${input.sessionVolumeName}
          AND pool."reserved_by_worker_id" IS NULL
          AND pool."last_error" LIKE ${`${LEGACY_WARM_RECLAIM_MARKER}%`}
        FOR UPDATE OF pool
      `);
      const lockedRows = (locked as unknown as { rows?: IWorkerWarmPool[] })
        .rows;
      if (!lockedRows?.[0]) {
        return null;
      }

      const assertUnreferenced = async (): Promise<void> => {
        const proof = await tx.execute(sql`
          SELECT EXISTS (
            SELECT 1
            FROM "worker_warm_pool" AS pool
            WHERE pool."warm_pool_id" = ${input.warmPoolId}
              AND pool."state" = ${EWorkerWarmPoolState.deleting}
              AND pool."server_id" = ${input.serverId}
              AND pool."worker_type_id" = ${input.workerTypeId}
              AND pool."container_id" = ${input.containerId}
              AND pool."container_name" = ${input.containerName}
              AND pool."session_volume_name" = ${input.sessionVolumeName}
              AND pool."reserved_by_worker_id" IS NULL
              AND pool."last_error" LIKE
                ${`${LEGACY_WARM_RECLAIM_MARKER}%`}
              AND NOT EXISTS (
                SELECT 1
                FROM "worker_runtime" AS runtime
                WHERE runtime."warm_pool_id" = pool."warm_pool_id"
                  OR runtime."container_id" = ${input.containerId}
                  OR runtime."container_name" = ${input.containerName}
                  OR runtime."session_volume_name" =
                    pool."session_volume_name"
              )
              AND NOT EXISTS (
                SELECT 1
                FROM "worker" AS owner
                WHERE owner."container_id" = ${input.containerId}
              )
              AND NOT EXISTS (
                SELECT 1
                FROM "worker_warm_pool" AS other_pool
                WHERE other_pool."warm_pool_id" <> pool."warm_pool_id"
                  AND (
                    other_pool."container_id" = ${input.containerId}
                    OR other_pool."container_name" = ${input.containerName}
                    OR other_pool."session_volume_name" =
                      pool."session_volume_name"
                  )
              )
              AND NOT EXISTS (
                SELECT 1
                FROM "whatsapp_session_storage_migration" AS migration
                WHERE migration."source_volume_name" =
                  pool."session_volume_name"
                  AND migration."source_volume_preserved" = true
                  AND migration."state" <> 'completed'
              )
          ) AS "safe"
        `);
        const proofRows = (
          proof as unknown as { rows?: Array<{ safe: boolean }> }
        ).rows;
        if (proofRows?.[0]?.safe !== true) {
          throw new Error('legacy_warm_reclaim_database_proof_changed');
        }
      };

      await assertUnreferenced();
      const operationResult = await operation({ assertUnreferenced });
      await assertUnreferenced();

      const deleted = await tx.execute(sql`
        DELETE FROM "worker_warm_pool" AS pool
        WHERE pool."warm_pool_id" = ${input.warmPoolId}
          AND pool."state" = ${EWorkerWarmPoolState.deleting}
          AND pool."server_id" = ${input.serverId}
          AND pool."worker_type_id" = ${input.workerTypeId}
          AND pool."container_id" = ${input.containerId}
          AND pool."container_name" = ${input.containerName}
          AND pool."session_volume_name" = ${input.sessionVolumeName}
          AND pool."reserved_by_worker_id" IS NULL
          AND pool."last_error" LIKE ${`${LEGACY_WARM_RECLAIM_MARKER}%`}
          AND NOT EXISTS (
            SELECT 1
            FROM "worker_runtime" AS runtime
            WHERE runtime."warm_pool_id" = pool."warm_pool_id"
              OR runtime."container_id" = ${input.containerId}
              OR runtime."container_name" = ${input.containerName}
              OR runtime."session_volume_name" =
                pool."session_volume_name"
          )
          AND NOT EXISTS (
            SELECT 1
            FROM "worker" AS owner
            WHERE owner."container_id" = ${input.containerId}
          )
          AND NOT EXISTS (
            SELECT 1
            FROM "worker_warm_pool" AS other_pool
            WHERE other_pool."warm_pool_id" <> pool."warm_pool_id"
              AND (
                other_pool."container_id" = ${input.containerId}
                OR other_pool."container_name" = ${input.containerName}
                OR other_pool."session_volume_name" =
                  pool."session_volume_name"
              )
          )
          AND NOT EXISTS (
            SELECT 1
            FROM "whatsapp_session_storage_migration" AS migration
            WHERE migration."source_volume_name" =
              pool."session_volume_name"
              AND migration."source_volume_preserved" = true
              AND migration."state" <> 'completed'
          )
        RETURNING pool."warm_pool_id"
      `);
      const deletedRows = (
        deleted as unknown as { rows?: Array<{ warm_pool_id: string }> }
      ).rows;
      if (deletedRows?.[0]?.warm_pool_id !== input.warmPoolId) {
        throw new Error('legacy_warm_reclaim_delete_state_changed');
      }

      return operationResult;
    });
  }

  /**
   * A warm container may already have been converted to an active worker
   * before an abandoned activation is reconciled. Missing worker_runtime
   * metadata is not deletion authority for that physical runtime. Keep the
   * warm row and its owner worker row locked while Docker is inspected and
   * changed, and authorize cleanup only when the owner was soft-deleted or
   * durably points at a different replacement container.
   */
  async withConvertedDeletingReclaimFence<T>(
    input: ConvertedWarmReclaimInput,
    operation: (fence: ConvertedWarmReclaimDatabaseFence) => Promise<T>
  ): Promise<T | null> {
    return this.dbRw.transaction(async (tx) => {
      const locked = await tx.execute(sql`
        SELECT
          pool."warm_pool_id",
          owner."deleted_at" AS "owner_deleted_at",
          owner."container_id" AS "owner_container_id",
          owner."account_id" AS "owner_account_id"
        FROM "worker_warm_pool" AS pool
        INNER JOIN "worker" AS owner
          ON owner."worker_id" = pool."reserved_by_worker_id"
        WHERE pool."warm_pool_id" = ${input.warmPoolId}
          AND pool."state" = ${EWorkerWarmPoolState.deleting}
          AND pool."server_id" = ${input.serverId}
          AND pool."worker_type_id" = ${input.workerTypeId}
          AND pool."container_id" = ${input.containerId}
          AND pool."container_name" = ${input.containerName}
          AND pool."session_volume_name" = ${input.sessionVolumeName}
          AND pool."reserved_by_worker_id" = ${input.ownerWorkerId}
          AND pool."last_error" LIKE
            ${`${CONVERTED_WARM_RECLAIM_MARKER}%`}
          AND owner."worker_id" = ${input.ownerWorkerId}
          AND owner."server_id" = ${input.serverId}
          AND owner."worker_type_id" = ${input.workerTypeId}
          AND (
            owner."deleted_at" IS NOT NULL
            OR (
              owner."container_id" IS NOT NULL
              AND owner."container_id" <> ${input.containerId}
            )
          )
          AND NOT EXISTS (
            SELECT 1
            FROM "worker_runtime" AS runtime
            WHERE runtime."warm_pool_id" = pool."warm_pool_id"
              OR runtime."container_id" = ${input.containerId}
              OR runtime."container_name" = ${input.containerName}
              OR runtime."session_volume_name" =
                pool."session_volume_name"
          )
          AND NOT EXISTS (
            SELECT 1
            FROM "worker" AS any_owner
            WHERE any_owner."container_id" = ${input.containerId}
              AND any_owner."deleted_at" IS NULL
          )
          AND NOT EXISTS (
            SELECT 1
            FROM "worker_warm_pool" AS other_pool
            WHERE other_pool."warm_pool_id" <> pool."warm_pool_id"
              AND (
                other_pool."container_id" = ${input.containerId}
                OR other_pool."container_name" = ${input.containerName}
                OR other_pool."session_volume_name" =
                  pool."session_volume_name"
              )
          )
          AND NOT EXISTS (
            SELECT 1
            FROM "whatsapp_session_storage_migration" AS migration
            WHERE migration."source_volume_name" =
              pool."session_volume_name"
              AND migration."source_volume_preserved" = true
              AND migration."state" <> 'completed'
          )
        FOR UPDATE OF pool, owner
      `);
      const lockedRows = (
        locked as unknown as {
          rows?: Array<{
            warm_pool_id: string;
            owner_deleted_at: string | null;
            owner_container_id: string | null;
            owner_account_id: string;
          }>;
        }
      ).rows;
      const lockedRow = lockedRows?.[0];
      if (!lockedRow) {
        return null;
      }

      const ownerMode =
        lockedRow.owner_deleted_at !== null ? 'deleted' : 'replacement';
      const ownerAccountId = lockedRow.owner_account_id?.trim();
      const replacementContainerId =
        ownerMode === 'replacement'
          ? lockedRow.owner_container_id?.trim()
          : undefined;
      if (
        !ownerAccountId ||
        (ownerMode === 'replacement' && !replacementContainerId)
      ) {
        return null;
      }

      const assertSafe = async (): Promise<void> => {
        const proof = await tx.execute(sql`
          SELECT EXISTS (
            SELECT 1
            FROM "worker_warm_pool" AS pool
            INNER JOIN "worker" AS owner
              ON owner."worker_id" = pool."reserved_by_worker_id"
            WHERE pool."warm_pool_id" = ${input.warmPoolId}
              AND pool."state" = ${EWorkerWarmPoolState.deleting}
              AND pool."server_id" = ${input.serverId}
              AND pool."worker_type_id" = ${input.workerTypeId}
              AND pool."container_id" = ${input.containerId}
              AND pool."container_name" = ${input.containerName}
              AND pool."session_volume_name" = ${input.sessionVolumeName}
              AND pool."reserved_by_worker_id" = ${input.ownerWorkerId}
              AND pool."last_error" LIKE
                ${`${CONVERTED_WARM_RECLAIM_MARKER}%`}
              AND owner."worker_id" = ${input.ownerWorkerId}
              AND owner."account_id" = ${ownerAccountId}
              AND owner."server_id" = ${input.serverId}
              AND owner."worker_type_id" = ${input.workerTypeId}
              AND (
                (
                  ${ownerMode === 'deleted'}
                  AND owner."deleted_at" IS NOT NULL
                )
                OR (
                  ${ownerMode === 'replacement'}
                  AND owner."deleted_at" IS NULL
                  AND owner."container_id" =
                    ${replacementContainerId ?? null}
                  AND owner."container_id" <> ${input.containerId}
                )
              )
              AND NOT EXISTS (
                SELECT 1
                FROM "worker_runtime" AS runtime
                WHERE runtime."warm_pool_id" = pool."warm_pool_id"
                  OR runtime."container_id" = ${input.containerId}
                  OR runtime."container_name" = ${input.containerName}
                  OR runtime."session_volume_name" =
                    pool."session_volume_name"
              )
              AND NOT EXISTS (
                SELECT 1
                FROM "worker" AS any_owner
                WHERE any_owner."container_id" = ${input.containerId}
                  AND any_owner."deleted_at" IS NULL
                  AND any_owner."worker_id" <> ${input.ownerWorkerId}
              )
              AND NOT EXISTS (
                SELECT 1
                FROM "worker_warm_pool" AS other_pool
                WHERE other_pool."warm_pool_id" <> pool."warm_pool_id"
                  AND (
                    other_pool."container_id" = ${input.containerId}
                    OR other_pool."container_name" = ${input.containerName}
                    OR other_pool."session_volume_name" =
                      pool."session_volume_name"
                  )
              )
              AND NOT EXISTS (
                SELECT 1
                FROM "whatsapp_session_storage_migration" AS migration
                WHERE migration."source_volume_name" =
                  pool."session_volume_name"
                  AND migration."source_volume_preserved" = true
                  AND migration."state" <> 'completed'
              )
          ) AS "safe"
        `);
        const proofRows = (
          proof as unknown as { rows?: Array<{ safe: boolean }> }
        ).rows;
        if (proofRows?.[0]?.safe !== true) {
          throw new Error('converted_warm_reclaim_database_proof_changed');
        }
      };

      await assertSafe();
      const result = await operation({
        ownerMode,
        ownerAccountId,
        ...(replacementContainerId ? { replacementContainerId } : {}),
        assertSafe,
      });
      await assertSafe();

      const deleted = await tx.execute(sql`
        DELETE FROM "worker_warm_pool" AS pool
        USING "worker" AS owner
        WHERE pool."warm_pool_id" = ${input.warmPoolId}
          AND pool."state" = ${EWorkerWarmPoolState.deleting}
          AND pool."server_id" = ${input.serverId}
          AND pool."worker_type_id" = ${input.workerTypeId}
          AND pool."container_id" = ${input.containerId}
          AND pool."container_name" = ${input.containerName}
          AND pool."session_volume_name" = ${input.sessionVolumeName}
          AND pool."reserved_by_worker_id" = ${input.ownerWorkerId}
          AND pool."last_error" LIKE
            ${`${CONVERTED_WARM_RECLAIM_MARKER}%`}
          AND owner."worker_id" = pool."reserved_by_worker_id"
          AND owner."worker_id" = ${input.ownerWorkerId}
          AND owner."account_id" = ${ownerAccountId}
          AND owner."server_id" = ${input.serverId}
          AND owner."worker_type_id" = ${input.workerTypeId}
          AND (
            (
              ${ownerMode === 'deleted'}
              AND owner."deleted_at" IS NOT NULL
            )
            OR (
              ${ownerMode === 'replacement'}
              AND owner."deleted_at" IS NULL
              AND owner."container_id" = ${replacementContainerId ?? null}
              AND owner."container_id" <> ${input.containerId}
            )
          )
          AND NOT EXISTS (
            SELECT 1
            FROM "worker_runtime" AS runtime
            WHERE runtime."warm_pool_id" = pool."warm_pool_id"
              OR runtime."container_id" = ${input.containerId}
              OR runtime."container_name" = ${input.containerName}
              OR runtime."session_volume_name" =
                pool."session_volume_name"
          )
          AND NOT EXISTS (
            SELECT 1
            FROM "worker" AS any_owner
            WHERE any_owner."container_id" = ${input.containerId}
              AND any_owner."deleted_at" IS NULL
              AND any_owner."worker_id" <> ${input.ownerWorkerId}
          )
          AND NOT EXISTS (
            SELECT 1
            FROM "worker_warm_pool" AS other_pool
            WHERE other_pool."warm_pool_id" <> pool."warm_pool_id"
              AND (
                other_pool."container_id" = ${input.containerId}
                OR other_pool."container_name" = ${input.containerName}
                OR other_pool."session_volume_name" =
                  pool."session_volume_name"
              )
          )
          AND NOT EXISTS (
            SELECT 1
            FROM "whatsapp_session_storage_migration" AS migration
            WHERE migration."source_volume_name" =
              pool."session_volume_name"
              AND migration."source_volume_preserved" = true
              AND migration."state" <> 'completed'
          )
        RETURNING pool."warm_pool_id"
      `);
      const deletedRows = (
        deleted as unknown as { rows?: Array<{ warm_pool_id: string }> }
      ).rows;
      if (deletedRows?.[0]?.warm_pool_id !== input.warmPoolId) {
        throw new Error('converted_warm_reclaim_delete_state_changed');
      }

      return result;
    });
  }

  /**
   * Finalizes a legacy row with no durable container pointer while holding its
   * deleting-row lock. The callback must prove the canonical container is
   * absent and may remove an unmounted orphan volume by immutable Docker
   * signature; DB ownership is checked immediately before and after it.
   */
  async finalizeLegacyDeletingResourcesAbsent(
    input: LegacyWarmAbsentResourcesInput,
    finalizePhysicalResources: (
      fence: LegacyWarmAbsentResourcesDatabaseFence
    ) => Promise<void>
  ): Promise<boolean> {
    return this.dbRw.transaction(async (tx) => {
      const locked = await tx.execute(sql`
        SELECT pool."warm_pool_id"
        FROM "worker_warm_pool" AS pool
        WHERE pool."warm_pool_id" = ${input.warmPoolId}
          AND pool."state" = ${EWorkerWarmPoolState.deleting}
          AND pool."server_id" = ${input.serverId}
          AND pool."worker_type_id" = ${input.workerTypeId}
          AND pool."container_id" IS NULL
          AND pool."container_name" IS NULL
          AND pool."session_volume_name" = ${input.sessionVolumeName}
          AND pool."reserved_by_worker_id" IS NULL
        FOR UPDATE OF pool
      `);
      const lockedRows = (
        locked as unknown as { rows?: Array<{ warm_pool_id: string }> }
      ).rows;
      if (lockedRows?.[0]?.warm_pool_id !== input.warmPoolId) {
        return false;
      }

      const assertUnreferenced = async (): Promise<void> => {
        const proof = await tx.execute(sql`
          SELECT EXISTS (
            SELECT 1
            FROM "worker_warm_pool" AS pool
            WHERE pool."warm_pool_id" = ${input.warmPoolId}
              AND pool."state" = ${EWorkerWarmPoolState.deleting}
              AND pool."server_id" = ${input.serverId}
              AND pool."worker_type_id" = ${input.workerTypeId}
              AND pool."container_id" IS NULL
              AND pool."container_name" IS NULL
              AND pool."session_volume_name" = ${input.sessionVolumeName}
              AND pool."reserved_by_worker_id" IS NULL
              AND NOT EXISTS (
                SELECT 1
                FROM "worker_runtime" AS runtime
                WHERE runtime."warm_pool_id" = pool."warm_pool_id"
                  OR runtime."container_name" = ${input.containerName}
                  OR runtime."session_volume_name" =
                    pool."session_volume_name"
              )
              AND NOT EXISTS (
                SELECT 1
                FROM "worker_warm_pool" AS other_pool
                WHERE other_pool."warm_pool_id" <> pool."warm_pool_id"
                  AND (
                    other_pool."container_name" = ${input.containerName}
                    OR other_pool."session_volume_name" =
                      pool."session_volume_name"
                  )
              )
              AND NOT EXISTS (
                SELECT 1
                FROM "whatsapp_session_storage_migration" AS migration
                WHERE migration."source_volume_name" =
                  pool."session_volume_name"
                  AND migration."source_volume_preserved" = true
                  AND migration."state" <> 'completed'
              )
          ) AS "safe"
        `);
        const proofRows = (
          proof as unknown as { rows?: Array<{ safe: boolean }> }
        ).rows;
        if (proofRows?.[0]?.safe !== true) {
          throw new Error('legacy_warm_absent_database_proof_changed');
        }
      };

      await assertUnreferenced();
      await finalizePhysicalResources({ assertUnreferenced });
      await assertUnreferenced();

      const deleted = await tx.execute(sql`
        DELETE FROM "worker_warm_pool" AS pool
        WHERE pool."warm_pool_id" = ${input.warmPoolId}
          AND pool."state" = ${EWorkerWarmPoolState.deleting}
          AND pool."server_id" = ${input.serverId}
          AND pool."worker_type_id" = ${input.workerTypeId}
          AND pool."container_id" IS NULL
          AND pool."container_name" IS NULL
          AND pool."session_volume_name" = ${input.sessionVolumeName}
          AND pool."reserved_by_worker_id" IS NULL
          AND NOT EXISTS (
            SELECT 1
            FROM "worker_runtime" AS runtime
            WHERE runtime."warm_pool_id" = pool."warm_pool_id"
              OR runtime."container_name" = ${input.containerName}
              OR runtime."session_volume_name" =
                pool."session_volume_name"
          )
          AND NOT EXISTS (
            SELECT 1
            FROM "worker_warm_pool" AS other_pool
            WHERE other_pool."warm_pool_id" <> pool."warm_pool_id"
              AND (
                other_pool."container_name" = ${input.containerName}
                OR other_pool."session_volume_name" =
                  pool."session_volume_name"
              )
          )
          AND NOT EXISTS (
            SELECT 1
            FROM "whatsapp_session_storage_migration" AS migration
            WHERE migration."source_volume_name" =
              pool."session_volume_name"
              AND migration."source_volume_preserved" = true
              AND migration."state" <> 'completed'
          )
        RETURNING pool."warm_pool_id"
      `);
      const deletedRows = (
        deleted as unknown as { rows?: Array<{ warm_pool_id: string }> }
      ).rows;
      return deletedRows?.[0]?.warm_pool_id === input.warmPoolId;
    });
  }

  async recordDeleteRetryFailure(
    warmPoolId: string,
    error: string
  ): Promise<boolean> {
    const boundedError = error.slice(0, 1000);
    const result = await this.dbRw
      .update(workerWarmPool)
      .set({
        last_error: sql`
          CASE
            WHEN ${workerWarmPool.last_error} LIKE
              cast(${`${LEGACY_WARM_RECLAIM_MARKER}%`} as text)
              THEN left(
                concat(
                  cast(${LEGACY_WARM_RECLAIM_MARKER} as text),
                  ':retry:',
                  cast(${boundedError} as text)
                ),
                1000
              )
            WHEN ${workerWarmPool.last_error} LIKE
              cast(${`${CONVERTED_WARM_RECLAIM_MARKER}%`} as text)
              THEN left(
                concat(
                  cast(${CONVERTED_WARM_RECLAIM_MARKER} as text),
                  ':retry:',
                  cast(${boundedError} as text)
                ),
                1000
              )
            ELSE cast(${boundedError} as text)
          END
        `,
        updated_at: currentTime(),
      })
      .where(
        and(
          eq(workerWarmPool.warm_pool_id, warmPoolId),
          eq(workerWarmPool.state, EWorkerWarmPoolState.deleting)
        )
      )
      .execute();

    return result.rowCount === 1;
  }

  async reconcileDeletingRuntimeLineage(warmPoolId: string): Promise<boolean> {
    const now = currentTime();
    const result = await this.dbRw.execute(sql`
      WITH target AS MATERIALIZED (
        SELECT
          pool."warm_pool_id",
          pool."container_id",
          pool."container_name",
          pool."session_volume_name",
          pool."state"
        FROM "worker_warm_pool" AS pool
        WHERE pool."warm_pool_id" = ${warmPoolId}
        FOR UPDATE
      ),
      runtime_match AS MATERIALIZED (
        SELECT
          runtime."worker_id",
          runtime."container_id",
          runtime."container_name",
          runtime."session_volume_name"
        FROM "worker_runtime" AS runtime, target
        WHERE runtime."warm_pool_id" = target."warm_pool_id"
          OR (
            target."container_id" IS NOT NULL
            AND runtime."container_id" = target."container_id"
          )
          OR (
            target."container_name" IS NOT NULL
            AND runtime."container_name" = target."container_name"
          )
          OR runtime."session_volume_name" = target."session_volume_name"
        ORDER BY
          CASE
            WHEN runtime."warm_pool_id" = target."warm_pool_id" THEN 0
            WHEN (
              target."container_id" IS NOT NULL
              AND runtime."container_id" = target."container_id"
            ) THEN 1
            WHEN (
              target."container_name" IS NOT NULL
              AND runtime."container_name" = target."container_name"
            ) THEN 2
            ELSE 3
          END,
          runtime."updated_at" DESC NULLS LAST,
          runtime."worker_id" ASC
        LIMIT 1
      ),
      reconciled AS (
        UPDATE "worker_warm_pool" AS pool
        SET
          "state" = ${EWorkerWarmPoolState.assigned},
          "container_id" = COALESCE(runtime_match."container_id", pool."container_id"),
          "container_name" = COALESCE(
            runtime_match."container_name",
            pool."container_name"
          ),
          "session_volume_name" = runtime_match."session_volume_name",
          "reserved_by_worker_id" = runtime_match."worker_id",
          "reservation_expires_at" = NULL,
          "last_health_at" = NULL,
          "last_error" = NULL,
          "updated_at" = ${now}
        FROM target, runtime_match
        WHERE pool."warm_pool_id" = target."warm_pool_id"
          AND pool."state" = ${EWorkerWarmPoolState.deleting}
        RETURNING pool."warm_pool_id"
      )
      SELECT (
        EXISTS (SELECT 1 FROM reconciled)
        OR EXISTS (
          SELECT 1
          FROM target, runtime_match
          WHERE target."state" <> ${EWorkerWarmPoolState.deleting}
        )
      ) AS "reconciled"
    `);

    const rows = (
      result as unknown as { rows?: Array<{ reconciled: boolean }> }
    ).rows;
    return rows?.[0]?.reconciled === true;
  }

  async claimErrorsForCleanup(
    input: ClaimWarmPoolCleanupInput
  ): Promise<IWorkerWarmPool[]> {
    const limit = boundedBatchLimit(input.limit);
    const now = currentTime();
    const result = await this.dbRw.execute(sql`
      WITH selected AS (
        SELECT "warm_pool_id"
        FROM "worker_warm_pool"
        WHERE "state" = ${EWorkerWarmPoolState.error}
          AND "updated_at" <= ${input.staleBefore}
          AND EXISTS (
            SELECT 1
            FROM "server" AS active_server
            WHERE active_server."server_id" =
                "worker_warm_pool"."server_id"
              AND active_server."deleted_at" IS NULL
              AND EXISTS (
                SELECT 1
                FROM "server_web" AS active_web
                WHERE active_web."server_id" = active_server."server_id"
                  AND active_web."deleted_at" IS NULL
              )
          )
          AND NOT EXISTS (
            SELECT 1
            FROM "worker_runtime"
            WHERE "worker_runtime"."warm_pool_id" =
                "worker_warm_pool"."warm_pool_id"
              OR (
                "worker_warm_pool"."container_id" IS NOT NULL
                AND "worker_runtime"."container_id" =
                  "worker_warm_pool"."container_id"
              )
              OR (
                "worker_warm_pool"."container_name" IS NOT NULL
                AND "worker_runtime"."container_name" =
                  "worker_warm_pool"."container_name"
              )
              OR "worker_runtime"."session_volume_name" =
                "worker_warm_pool"."session_volume_name"
          )
        ORDER BY "updated_at" ASC, "warm_pool_id" ASC
        LIMIT ${limit}
        FOR UPDATE SKIP LOCKED
      )
      UPDATE "worker_warm_pool"
      SET
        "state" = ${EWorkerWarmPoolState.deleting},
        "updated_at" = ${now},
        "last_error" = COALESCE(
          "worker_warm_pool"."last_error",
          'warm_runtime_error_cleanup'
        )
      FROM selected
      WHERE "worker_warm_pool"."warm_pool_id" = selected."warm_pool_id"
        AND "worker_warm_pool"."state" = ${EWorkerWarmPoolState.error}
        AND NOT EXISTS (
          SELECT 1
          FROM "worker_runtime"
          WHERE "worker_runtime"."warm_pool_id" =
              "worker_warm_pool"."warm_pool_id"
            OR (
              "worker_warm_pool"."container_id" IS NOT NULL
              AND "worker_runtime"."container_id" =
                "worker_warm_pool"."container_id"
            )
            OR (
              "worker_warm_pool"."container_name" IS NOT NULL
              AND "worker_runtime"."container_name" =
                "worker_warm_pool"."container_name"
            )
            OR "worker_runtime"."session_volume_name" =
              "worker_warm_pool"."session_volume_name"
        )
      RETURNING
        "worker_warm_pool"."warm_pool_id",
        "worker_warm_pool"."server_id",
        "worker_warm_pool"."worker_type_id",
        "worker_warm_pool"."container_id",
        "worker_warm_pool"."container_name",
        "worker_warm_pool"."session_storage",
        "worker_warm_pool"."session_volume_name",
        "worker_warm_pool"."state",
        "worker_warm_pool"."reserved_by_worker_id",
        "worker_warm_pool"."reservation_expires_at",
        "worker_warm_pool"."last_health_at",
        "worker_warm_pool"."last_error",
        "worker_warm_pool"."created_at",
        "worker_warm_pool"."updated_at"
    `);

    const rows = (result as unknown as { rows?: IWorkerWarmPool[] }).rows;
    return rows ?? [];
  }

  async deleteUnreferencedAssignedForCleanup(
    input: ClaimWarmPoolCleanupInput
  ): Promise<IWorkerWarmPool[]> {
    const limit = boundedBatchLimit(input.limit);
    const result = await this.dbRw.execute(sql`
      WITH selected AS (
        SELECT pool."warm_pool_id"
        FROM "worker_warm_pool" AS pool
        WHERE pool."state" = ${EWorkerWarmPoolState.assigned}
          AND pool."updated_at" <= ${input.staleBefore}
          AND NOT EXISTS (
            SELECT 1
            FROM "worker_runtime" AS runtime
            WHERE runtime."warm_pool_id" = pool."warm_pool_id"
              OR (
                pool."container_id" IS NOT NULL
                AND runtime."container_id" = pool."container_id"
              )
              OR (
                pool."container_name" IS NOT NULL
                AND runtime."container_name" = pool."container_name"
              )
              OR runtime."session_volume_name" = pool."session_volume_name"
          )
          AND NOT EXISTS (
            SELECT 1
            FROM "whatsapp_session_storage_migration" AS migration
            WHERE migration."source_volume_name" =
              pool."session_volume_name"
              AND migration."source_volume_preserved" = true
              AND migration."state" <> 'completed'
          )
        ORDER BY pool."updated_at" ASC, pool."warm_pool_id" ASC
        LIMIT ${limit}
        FOR UPDATE SKIP LOCKED
      )
      DELETE FROM "worker_warm_pool"
      USING selected
      WHERE "worker_warm_pool"."warm_pool_id" = selected."warm_pool_id"
        AND "worker_warm_pool"."state" = ${EWorkerWarmPoolState.assigned}
        AND NOT EXISTS (
          SELECT 1
          FROM "worker_runtime" AS runtime
          WHERE runtime."warm_pool_id" = "worker_warm_pool"."warm_pool_id"
            OR (
              "worker_warm_pool"."container_id" IS NOT NULL
              AND runtime."container_id" = "worker_warm_pool"."container_id"
            )
            OR (
              "worker_warm_pool"."container_name" IS NOT NULL
              AND runtime."container_name" =
                "worker_warm_pool"."container_name"
            )
            OR runtime."session_volume_name" =
              "worker_warm_pool"."session_volume_name"
        )
        AND NOT EXISTS (
          SELECT 1
          FROM "whatsapp_session_storage_migration" AS migration
          WHERE migration."source_volume_name" =
            "worker_warm_pool"."session_volume_name"
            AND migration."source_volume_preserved" = true
            AND migration."state" <> 'completed'
        )
      RETURNING
        "worker_warm_pool"."warm_pool_id",
        "worker_warm_pool"."server_id",
        "worker_warm_pool"."worker_type_id",
        "worker_warm_pool"."container_id",
        "worker_warm_pool"."container_name",
        "worker_warm_pool"."session_storage",
        "worker_warm_pool"."session_volume_name",
        "worker_warm_pool"."state",
        "worker_warm_pool"."reserved_by_worker_id",
        "worker_warm_pool"."reservation_expires_at",
        "worker_warm_pool"."last_health_at",
        "worker_warm_pool"."last_error",
        "worker_warm_pool"."created_at",
        "worker_warm_pool"."updated_at"
    `);

    const rows = (result as unknown as { rows?: IWorkerWarmPool[] }).rows;
    return rows ?? [];
  }

  async claimDockerOrphanForCleanup(
    input: ClaimDockerOrphanWarmPoolInput
  ): Promise<boolean> {
    const now = currentTime();
    const result = await this.dbRw.execute(sql`
      INSERT INTO "worker_warm_pool" (
        "warm_pool_id",
        "server_id",
        "worker_type_id",
        "container_id",
        "container_name",
        "session_storage",
        "session_volume_name",
        "state",
        "last_error",
        "created_at",
        "updated_at"
      )
      SELECT
        ${input.warmPoolId},
        ${input.serverId},
        ${input.workerTypeId},
        ${input.containerId},
        ${input.containerName},
        ${input.sessionStorage},
        ${input.sessionVolumeName},
        ${EWorkerWarmPoolState.deleting},
        'warm_runtime_orphaned_in_docker',
        ${now},
        ${now}
      WHERE NOT EXISTS (
        SELECT 1
        FROM "worker_runtime"
        WHERE "warm_pool_id" = ${input.warmPoolId}
          OR "container_name" = ${input.containerName}
          OR (
            ${input.sessionVolumeName}::text IS NOT NULL
            AND "session_volume_name" = ${input.sessionVolumeName}
          )
      )
      AND NOT EXISTS (
        SELECT 1
        FROM "whatsapp_session_storage_migration" AS migration
        WHERE migration."source_volume_name" = ${input.sessionVolumeName}
          AND migration."source_volume_preserved" = true
          AND migration."state" <> 'completed'
      )
      ON CONFLICT ("warm_pool_id") DO NOTHING
      RETURNING "warm_pool_id"
    `);

    const rows = (
      result as unknown as { rows?: Array<{ warm_pool_id: string }> }
    ).rows;
    return rows?.length === 1;
  }

  async claimUnpersistedWarmingRuntimeForCleanup(
    input: ClaimUnpersistedWarmingRuntimeCleanupInput
  ): Promise<IWorkerWarmPool | null> {
    const now = currentTime();
    const result = await this.dbRw.execute(sql`
      UPDATE "worker_warm_pool" AS pool
      SET
        "state" = ${EWorkerWarmPoolState.deleting},
        "container_id" = ${input.containerId},
        "container_name" = ${input.containerName},
        "last_error" = 'warm_creation_unpersisted_physical_runtime',
        "updated_at" = ${now}
      WHERE pool."warm_pool_id" = ${input.warmPoolId}
        AND pool."server_id" = ${input.serverId}
        AND pool."worker_type_id" = ${input.workerTypeId}
        AND pool."session_storage" = ${input.sessionStorage}
        AND pool."session_volume_name" IS NOT DISTINCT FROM
          ${input.sessionVolumeName}
        AND pool."state" = ${EWorkerWarmPoolState.warming}
        AND pool."container_id" IS NULL
        AND (
          pool."container_name" IS NULL
          OR pool."container_name" = ${input.containerName}
        )
        AND pool."updated_at" = ${input.expectedWarmUpdatedAt}
        AND NOT EXISTS (
          SELECT 1
          FROM "worker_runtime" AS runtime
          WHERE runtime."warm_pool_id" = pool."warm_pool_id"
            OR runtime."container_id" = ${input.containerId}
            OR runtime."container_name" = ${input.containerName}
            OR (
              pool."session_volume_name" IS NOT NULL
              AND runtime."session_volume_name" = pool."session_volume_name"
            )
        )
      RETURNING
        pool."warm_pool_id",
        pool."server_id",
        pool."worker_type_id",
        pool."container_id",
        pool."container_name",
        pool."session_storage",
        pool."session_volume_name",
        pool."state",
        pool."reserved_by_worker_id",
        pool."reservation_expires_at",
        pool."last_health_at",
        pool."last_error",
        pool."created_at",
        pool."updated_at"
    `);

    const rows = (result as unknown as { rows?: IWorkerWarmPool[] }).rows;
    return rows?.[0] ?? null;
  }

  async claimMissingRuntimeForCleanup(
    input: ClaimMissingWarmPoolRuntimeInput
  ): Promise<boolean> {
    const now = currentTime();
    const lastError = input.lastError ?? 'warm_runtime_missing_in_docker';
    const expectedContainerCondition = input.expectedContainerId
      ? sql`AND pool."container_id" = ${input.expectedContainerId}`
      : sql``;
    const result = await this.dbRw.execute(sql`
      UPDATE "worker_warm_pool" AS pool
      SET
        "state" = ${EWorkerWarmPoolState.deleting},
        "last_error" = ${lastError},
        "updated_at" = ${now}
      WHERE pool."warm_pool_id" = ${input.warmPoolId}
        AND pool."state" = ${EWorkerWarmPoolState.warming}
        ${expectedContainerCondition}
        AND NOT EXISTS (
          SELECT 1
          FROM "worker_runtime" AS runtime
          WHERE runtime."warm_pool_id" = pool."warm_pool_id"
            OR (
              pool."container_id" IS NOT NULL
              AND runtime."container_id" = pool."container_id"
            )
            OR (
              pool."container_name" IS NOT NULL
              AND runtime."container_name" = pool."container_name"
            )
            OR runtime."session_volume_name" = pool."session_volume_name"
        )
      RETURNING pool."warm_pool_id"
    `);

    const rows = (
      result as unknown as { rows?: Array<{ warm_pool_id: string }> }
    ).rows;
    return rows?.length === 1;
  }

  async claimStaleActivatingForCleanup(
    input: ClaimStaleActivatingWarmPoolCleanupInput
  ): Promise<IWorkerWarmPool | null> {
    const now = currentTime();
    const expectedOwner = input.expectedOwner;
    const result = await this.dbRw.execute(sql`
      UPDATE "worker_warm_pool" AS pool
      SET
        "state" = ${EWorkerWarmPoolState.deleting},
        "container_id" = ${input.cleanupContainerId},
        "container_name" = ${input.cleanupContainerName},
        "last_error" = ${input.lastError.slice(0, 1000)},
        "updated_at" = ${now}
      WHERE pool."warm_pool_id" = ${input.warmPoolId}
        AND pool."state" = ${EWorkerWarmPoolState.activating}
        AND pool."reserved_by_worker_id" = ${input.reservedByWorkerId}
        AND pool."container_id" = ${input.expectedSourceContainerId}
        AND pool."session_storage" = ${input.sessionStorage}
        AND pool."session_volume_name" IS NOT DISTINCT FROM
          ${input.sessionVolumeName}
        AND pool."updated_at" = ${input.expectedWarmUpdatedAt}
        AND EXISTS (
          SELECT 1
          FROM "server" AS target_server
          WHERE target_server."server_id" = pool."server_id"
            AND target_server."deleted_at" IS NULL
            AND target_server."server_status_id" = ${EServerStatus.online}
            AND EXISTS (
              SELECT 1
              FROM "server_web" AS active_web
              WHERE active_web."server_id" = target_server."server_id"
                AND active_web."deleted_at" IS NULL
            )
            AND EXISTS (
              SELECT 1
              FROM "server_ssh" AS active_ssh
              WHERE active_ssh."server_id" = target_server."server_id"
                AND active_ssh."deleted_at" IS NULL
            )
        )
        AND (
          (
            ${expectedOwner === null}
            AND NOT EXISTS (
              SELECT 1
              FROM "worker" AS owner
              WHERE owner."worker_id" = pool."reserved_by_worker_id"
            )
          )
          OR (
            ${expectedOwner !== null}
            AND EXISTS (
              SELECT 1
              FROM "worker" AS owner
              WHERE owner."worker_id" = pool."reserved_by_worker_id"
                AND owner."worker_id" = ${expectedOwner?.worker_id ?? null}
                AND owner."account_id" = ${expectedOwner?.account_id ?? null}
                AND owner."server_id" = ${expectedOwner?.server_id ?? null}
                AND owner."worker_type_id" =
                  ${expectedOwner?.worker_type_id ?? null}
                AND owner."worker_status_id" =
                  ${expectedOwner?.worker_status_id ?? null}
                AND owner."lifecycle_operation_id" IS NOT DISTINCT FROM
                  ${expectedOwner?.lifecycle_operation_id ?? null}
                AND owner."updated_at" IS NOT DISTINCT FROM
                  ${expectedOwner?.updated_at ?? null}
                AND owner."deleted_at" IS NOT DISTINCT FROM
                  ${expectedOwner?.deleted_at ?? null}
            )
          )
        )
        AND (
          ${input.cleanupContainerName !== input.reservedByWorkerId}
          OR (
            ${input.expectedOwner !== null}
            AND EXISTS (
              SELECT 1
              FROM "worker" AS converted_owner
              WHERE converted_owner."worker_id" =
                  pool."reserved_by_worker_id"
                AND (
                  converted_owner."deleted_at" IS NOT NULL
                  OR (
                    converted_owner."container_id" IS NOT NULL
                    AND converted_owner."container_id" <>
                      ${input.cleanupContainerId}
                  )
                )
            )
          )
        )
        AND NOT EXISTS (
          SELECT 1
          FROM "worker_runtime" AS runtime
          WHERE runtime."warm_pool_id" = pool."warm_pool_id"
            OR runtime."container_id" = pool."container_id"
            OR runtime."container_id" = ${input.cleanupContainerId}
            OR runtime."container_name" = pool."container_name"
            OR runtime."container_name" = ${input.cleanupContainerName}
            OR (
              pool."session_volume_name" IS NOT NULL
              AND runtime."session_volume_name" = pool."session_volume_name"
            )
        )
      RETURNING
        pool."warm_pool_id",
        pool."server_id",
        pool."worker_type_id",
        pool."container_id",
        pool."container_name",
        pool."session_storage",
        pool."session_volume_name",
        pool."state",
        pool."reserved_by_worker_id",
        pool."reservation_expires_at",
        pool."last_health_at",
        pool."last_error",
        pool."created_at",
        pool."updated_at"
    `);
    const rows = (result as unknown as { rows?: IWorkerWarmPool[] }).rows;
    return rows?.[0] ?? null;
  }

  async observeStartingRuntime(
    input: ObserveStartingWarmPoolRuntimeInput
  ): Promise<string | null> {
    const parsedFirstObservedAtMs = Number(input.firstObservedAtMs);
    const parsedRestartCount = Number(input.restartCount);
    const firstObservedAtMs = Number.isFinite(parsedFirstObservedAtMs)
      ? Math.max(0, Math.floor(parsedFirstObservedAtMs))
      : Date.now();
    const restartCount = Number.isFinite(parsedRestartCount)
      ? Math.max(0, Math.floor(parsedRestartCount))
      : 0;
    const initialMarker = `warm_runtime_starting:${firstObservedAtMs}:${restartCount}`;
    const result = await this.dbRw.execute(sql`
      UPDATE "worker_warm_pool" AS pool
      SET "last_error" = CASE
        WHEN pool."last_error" ~ '^warm_runtime_starting:[0-9]+:[0-9]+$'
          THEN concat(
            'warm_runtime_starting:',
            split_part(pool."last_error", ':', 2),
            ':',
            ${restartCount}::text
          )
        ELSE ${initialMarker}
      END
      WHERE pool."warm_pool_id" = ${input.warmPoolId}
        AND pool."state" = ${EWorkerWarmPoolState.warming}
        AND pool."container_id" = ${input.expectedContainerId}
        AND NOT EXISTS (
          SELECT 1
          FROM "worker_runtime" AS runtime
          WHERE runtime."warm_pool_id" = pool."warm_pool_id"
            OR runtime."container_id" = pool."container_id"
            OR (
              pool."container_name" IS NOT NULL
              AND runtime."container_name" = pool."container_name"
            )
            OR runtime."session_volume_name" = pool."session_volume_name"
        )
      RETURNING pool."last_error"
    `);

    const rows = (
      result as unknown as { rows?: Array<{ last_error: string | null }> }
    ).rows;
    return rows?.[0]?.last_error ?? null;
  }

  async confirmHealthyReadyRuntime(
    input: ConfirmHealthyReadyWarmPoolRuntimeInput
  ): Promise<boolean> {
    const now = currentTime();
    const result = await this.dbRw.execute(sql`
      UPDATE "worker_warm_pool" AS pool
      SET
        "last_health_at" = ${now},
        "last_error" = NULL
      WHERE pool."warm_pool_id" = ${input.warmPoolId}
        AND pool."state" = ${EWorkerWarmPoolState.ready}
        AND pool."container_id" = ${input.expectedContainerId}
        AND NOT EXISTS (
          SELECT 1
          FROM "worker_runtime" AS runtime
          WHERE runtime."warm_pool_id" = pool."warm_pool_id"
            OR runtime."container_id" = pool."container_id"
            OR (
              pool."container_name" IS NOT NULL
              AND runtime."container_name" = pool."container_name"
            )
            OR runtime."session_volume_name" = pool."session_volume_name"
        )
    `);

    return result.rowCount === 1;
  }

  async isRuntimeReferenceActive(
    input: WarmPoolRuntimeReferenceInput
  ): Promise<boolean> {
    const result = await this.dbRw.execute(sql`
      SELECT EXISTS (
        SELECT 1
        FROM "worker_runtime"
        WHERE "warm_pool_id" = ${input.warmPoolId}
          OR "container_name" = ${input.containerName}
          OR (
            ${input.sessionVolumeName}::text IS NOT NULL
            AND "session_volume_name" = ${input.sessionVolumeName}
          )
      ) AS "active"
    `);
    const rows = (result as unknown as { rows?: Array<{ active: boolean }> })
      .rows;
    return rows?.[0]?.active === true;
  }

  async listAdoptedRuntimeIdentitiesByServer(
    serverId: string
  ): Promise<AdoptedWarmRuntimeIdentity[]> {
    /*
     * Do not filter by worker status. Status is mutable after adoption; the
     * exact worker_runtime/container lineage is the ownership proof used by
     * the physical warm gate. A non-deleted offline or stopped channel must
     * not become a fake ambiguous standby and suppress new warm capacity.
     */
    const result = await this.dbRw
      .select({
        worker_id: worker.worker_id,
        account_id: worker.account_id,
        server_id: worker.server_id,
        worker_type_id: worker.worker_type_id,
        worker_status_id: worker.worker_status_id,
        worker_container_id: worker.container_id,
        lifecycle_operation_id: worker.lifecycle_operation_id,
        runtime_container_id: workerRuntime.container_id,
        runtime_container_name: workerRuntime.container_name,
        session_storage: workerRuntime.session_storage,
        session_volume_name: workerRuntime.session_volume_name,
        runtime_generation: workerRuntime.runtime_generation,
        warm_pool_id: workerRuntime.warm_pool_id,
      })
      .from(workerRuntime)
      .innerJoin(worker, eq(worker.worker_id, workerRuntime.worker_id))
      .where(
        and(
          eq(worker.server_id, serverId),
          isNull(worker.deleted_at),
          isNotNull(workerRuntime.container_id),
          isNotNull(workerRuntime.warm_pool_id)
        )
      )
      .execute();

    return result as AdoptedWarmRuntimeIdentity[];
  }

  async claimCapacityForReplenish(
    input: ClaimWarmPoolCapacityInput
  ): Promise<boolean> {
    const target = Math.max(0, Math.min(100, Math.floor(Number(input.target))));
    if (target === 0) {
      return false;
    }

    const now = currentTime();
    const result = await this.dbRw.execute(sql`
      WITH capacity_lock AS (
        SELECT pg_advisory_xact_lock(
          hashtextextended(
            concat(
              ${input.serverId}::text,
              ':',
              ${input.workerTypeId}::text
            ),
            0
          )
        )
      ),
      eligible_server AS MATERIALIZED (
        SELECT target_server."server_id"
        FROM "server" AS target_server, capacity_lock
        WHERE target_server."server_id" = ${input.serverId}
          AND target_server."deleted_at" IS NULL
          AND target_server."server_status_id" = ${EServerStatus.online}
          AND EXISTS (
            SELECT 1
            FROM "server_web" AS active_web
            WHERE active_web."server_id" = target_server."server_id"
              AND active_web."deleted_at" IS NULL
          )
          AND EXISTS (
            SELECT 1
            FROM "server_ssh" AS active_ssh
            WHERE active_ssh."server_id" = target_server."server_id"
              AND active_ssh."deleted_at" IS NULL
          )
      ),
      active_others AS (
        SELECT COUNT(*)::integer AS "value"
        FROM "worker_warm_pool" AS pool, eligible_server
        WHERE pool."server_id" = ${input.serverId}
          AND pool."worker_type_id" = ${input.workerTypeId}
          AND pool."session_storage" = ${EWorkerSessionStorage.postgres}
          AND pool."session_volume_name" IS NULL
          AND pool."warm_pool_id" <> ${input.warmPoolId}
          AND pool."state" IN (
            ${EWorkerWarmPoolState.warming},
            ${EWorkerWarmPoolState.ready},
            ${EWorkerWarmPoolState.reserved},
            ${EWorkerWarmPoolState.activating}
          )
          AND NOT EXISTS (
            SELECT 1
            FROM "worker_runtime" AS runtime
            WHERE runtime."warm_pool_id" = pool."warm_pool_id"
              OR (
                pool."container_id" IS NOT NULL
                AND runtime."container_id" = pool."container_id"
              )
              OR (
                pool."container_name" IS NOT NULL
                AND runtime."container_name" = pool."container_name"
              )
              OR runtime."session_volume_name" =
                pool."session_volume_name"
          )
      ),
      reclaimed AS (
        UPDATE "worker_warm_pool"
        SET
          "state" = ${EWorkerWarmPoolState.warming},
          "last_error" = NULL,
          "updated_at" = ${now}
        WHERE "warm_pool_id" = ${input.warmPoolId}
          AND "server_id" = ${input.serverId}
          AND "worker_type_id" = ${input.workerTypeId}
          AND "session_storage" = ${EWorkerSessionStorage.postgres}
          AND "session_volume_name" IS NULL
          AND "state" IN (
            ${EWorkerWarmPoolState.warming},
            ${EWorkerWarmPoolState.error}
          )
          AND "updated_at" >= ${input.retryAfter}
          AND EXISTS (SELECT 1 FROM eligible_server)
          AND (SELECT "value" FROM active_others) < ${target}
          AND NOT EXISTS (
            SELECT 1
            FROM "worker_runtime" AS runtime
            WHERE runtime."warm_pool_id" =
                "worker_warm_pool"."warm_pool_id"
              OR (
                "worker_warm_pool"."container_id" IS NOT NULL
                AND runtime."container_id" =
                  "worker_warm_pool"."container_id"
              )
              OR (
                "worker_warm_pool"."container_name" IS NOT NULL
                AND runtime."container_name" =
                  "worker_warm_pool"."container_name"
              )
              OR runtime."session_volume_name" =
                "worker_warm_pool"."session_volume_name"
          )
        RETURNING "warm_pool_id"
      ),
      inserted AS (
        INSERT INTO "worker_warm_pool" (
          "warm_pool_id",
          "server_id",
          "worker_type_id",
          "session_storage",
          "session_volume_name",
          "state",
          "created_at",
          "updated_at"
        )
        SELECT
          ${input.warmPoolId},
          ${input.serverId},
          ${input.workerTypeId},
          ${EWorkerSessionStorage.postgres},
          NULL,
          ${EWorkerWarmPoolState.warming},
          ${now},
          ${now}
        FROM eligible_server
        WHERE NOT EXISTS (
          SELECT 1
          FROM "worker_warm_pool"
          WHERE "warm_pool_id" = ${input.warmPoolId}
        )
          AND (SELECT "value" FROM active_others) < ${target}
        ON CONFLICT ("warm_pool_id") DO NOTHING
        RETURNING "warm_pool_id"
      )
      SELECT (
        EXISTS (SELECT 1 FROM reclaimed)
        OR EXISTS (SELECT 1 FROM inserted)
      ) AS "claimed"
    `);

    const rows = (result as unknown as { rows?: Array<{ claimed: boolean }> })
      .rows;
    return rows?.[0]?.claimed === true;
  }

  async reserveReady(
    serverId: string,
    workerTypeId: string,
    workerId: string,
    reservationExpiresAt: string,
    healthFreshAfter: string,
    sessionStorage: EWorkerSessionStorage = EWorkerSessionStorage.postgres
  ): Promise<IWorkerWarmPool | null> {
    if (sessionStorage !== EWorkerSessionStorage.postgres) {
      return null;
    }
    const now = currentTime();

    return this.dbRw.transaction(async (tx) => {
      const selected = await tx.execute(sql`
        SELECT "warm_pool_id"
        FROM "worker_warm_pool"
        WHERE "server_id" = ${serverId}
          AND "worker_type_id" = ${workerTypeId}
          AND "session_storage" = ${EWorkerSessionStorage.postgres}
          AND "session_volume_name" IS NULL
          AND "state" = ${EWorkerWarmPoolState.ready}
          AND "last_health_at" >= ${healthFreshAfter}
          AND ("container_name" IS NULL OR "container_name" LIKE 'warm-%')
          AND NOT EXISTS (
            SELECT 1
            FROM "worker_runtime"
            WHERE "worker_runtime"."warm_pool_id" = "worker_warm_pool"."warm_pool_id"
              OR (
                "worker_warm_pool"."container_id" IS NOT NULL
                AND "worker_runtime"."container_id" = "worker_warm_pool"."container_id"
              )
              OR (
                "worker_warm_pool"."container_name" IS NOT NULL
                AND "worker_runtime"."container_name" =
                  "worker_warm_pool"."container_name"
              )
              OR "worker_runtime"."session_volume_name" =
                "worker_warm_pool"."session_volume_name"
          )
        ORDER BY "last_health_at" DESC NULLS LAST, "created_at" ASC
        LIMIT 1
        FOR UPDATE SKIP LOCKED
      `);

      const rows = (
        selected as unknown as { rows?: Array<{ warm_pool_id: string }> }
      ).rows;
      const warmPoolId = rows?.[0]?.warm_pool_id;
      if (!warmPoolId) {
        return null;
      }

      const [reserved] = await tx
        .update(workerWarmPool)
        .set({
          state: EWorkerWarmPoolState.reserved,
          reserved_by_worker_id: workerId,
          reservation_expires_at: reservationExpiresAt,
          updated_at: now,
        })
        .where(
          and(
            eq(workerWarmPool.warm_pool_id, warmPoolId),
            eq(workerWarmPool.state, EWorkerWarmPoolState.ready)
          )
        )
        .returning()
        .execute();

      return (reserved as IWorkerWarmPool | undefined) ?? null;
    });
  }

  async markRuntime(input: UpdateWorkerWarmPoolRuntimeInput): Promise<boolean> {
    const updateInput: Partial<typeof workerWarmPool.$inferInsert> = {
      updated_at: currentTime(),
    };

    if ('container_id' in input) {
      updateInput.container_id = input.container_id;
    }
    if ('container_name' in input) {
      updateInput.container_name = input.container_name;
    }
    if (input.session_volume_name) {
      updateInput.session_volume_name = input.session_volume_name;
    }
    if (input.state) {
      updateInput.state = input.state;
    }
    if ('last_error' in input) {
      updateInput.last_error = input.last_error;
    }
    if (input.state === EWorkerWarmPoolState.ready) {
      updateInput.last_health_at = currentTime();
      updateInput.reserved_by_worker_id = null;
      updateInput.reservation_expires_at = null;
      updateInput.last_error = null;
    }

    const result = await this.dbRw
      .update(workerWarmPool)
      .set(updateInput)
      .where(eq(workerWarmPool.warm_pool_id, input.warm_pool_id))
      .execute();

    return result.rowCount === 1;
  }

  async finalizeCreationReady(
    input: FinalizeWarmPoolCreationInput
  ): Promise<boolean> {
    const result = await this.dbRw
      .update(workerWarmPool)
      .set({
        container_id: input.containerId,
        container_name: input.containerName,
        session_volume_name: input.sessionVolumeName,
        state: EWorkerWarmPoolState.ready,
        last_health_at: currentTime(),
        reserved_by_worker_id: null,
        reservation_expires_at: null,
        last_error: null,
        updated_at: currentTime(),
      })
      .where(
        and(
          eq(workerWarmPool.warm_pool_id, input.warmPoolId),
          eq(workerWarmPool.server_id, input.serverId),
          eq(workerWarmPool.worker_type_id, input.workerTypeId),
          eq(workerWarmPool.session_volume_name, input.sessionVolumeName),
          inArray(workerWarmPool.state, [
            EWorkerWarmPoolState.warming,
            EWorkerWarmPoolState.error,
          ])
        )
      )
      .execute();

    return result.rowCount === 1;
  }

  async finalizePostgresCreationReady(input: {
    warmPoolId: string;
    serverId: string;
    workerTypeId: string;
    containerId: string;
    containerName: string;
    runtimeCapabilityHash: string;
    writerEpoch: string;
  }): Promise<boolean> {
    const now = currentTime();
    const result = await this.dbRw
      .update(workerWarmPool)
      .set({
        container_id: input.containerId,
        container_name: input.containerName,
        runtime_capability_hash: input.runtimeCapabilityHash,
        session_writer_epoch: input.writerEpoch,
        state: EWorkerWarmPoolState.ready,
        last_health_at: now,
        reserved_by_worker_id: null,
        reservation_expires_at: null,
        last_error: null,
        updated_at: now,
      })
      .where(
        and(
          eq(workerWarmPool.warm_pool_id, input.warmPoolId),
          eq(workerWarmPool.server_id, input.serverId),
          eq(workerWarmPool.worker_type_id, input.workerTypeId),
          eq(workerWarmPool.session_storage, EWorkerSessionStorage.postgres),
          isNull(workerWarmPool.session_volume_name),
          or(
            and(
              isNull(workerWarmPool.runtime_capability_hash),
              isNull(workerWarmPool.session_writer_epoch)
            ),
            and(
              eq(
                workerWarmPool.runtime_capability_hash,
                input.runtimeCapabilityHash
              ),
              eq(workerWarmPool.session_writer_epoch, input.writerEpoch)
            )
          ),
          inArray(workerWarmPool.state, [
            EWorkerWarmPoolState.warming,
            EWorkerWarmPoolState.error,
          ])
        )
      )
      .execute();
    return result.rowCount === 1;
  }

  async recordCreationError(
    input: RecordWarmPoolCreationErrorInput
  ): Promise<boolean> {
    const result = await this.dbRw
      .update(workerWarmPool)
      .set({
        state: EWorkerWarmPoolState.error,
        last_error: input.error.slice(0, 1000),
        updated_at: currentTime(),
      })
      .where(
        and(
          eq(workerWarmPool.warm_pool_id, input.warmPoolId),
          eq(workerWarmPool.server_id, input.serverId),
          eq(workerWarmPool.worker_type_id, input.workerTypeId),
          eq(workerWarmPool.session_volume_name, input.sessionVolumeName),
          inArray(workerWarmPool.state, [
            EWorkerWarmPoolState.warming,
            EWorkerWarmPoolState.error,
          ])
        )
      )
      .execute();

    return result.rowCount === 1;
  }

  async recordPostgresCreationError(input: {
    warmPoolId: string;
    serverId: string;
    workerTypeId: string;
    error: string;
  }): Promise<boolean> {
    const result = await this.dbRw
      .update(workerWarmPool)
      .set({
        state: EWorkerWarmPoolState.error,
        last_error: input.error.slice(0, 1000),
        updated_at: currentTime(),
      })
      .where(
        and(
          eq(workerWarmPool.warm_pool_id, input.warmPoolId),
          eq(workerWarmPool.server_id, input.serverId),
          eq(workerWarmPool.worker_type_id, input.workerTypeId),
          eq(workerWarmPool.session_storage, EWorkerSessionStorage.postgres),
          isNull(workerWarmPool.session_volume_name),
          inArray(workerWarmPool.state, [
            EWorkerWarmPoolState.warming,
            EWorkerWarmPoolState.error,
          ])
        )
      )
      .execute();
    return result.rowCount === 1;
  }

  async restoreDeletingToReady(warmPoolId: string): Promise<boolean> {
    const result = await this.dbRw
      .update(workerWarmPool)
      .set({
        state: EWorkerWarmPoolState.ready,
        reserved_by_worker_id: null,
        reservation_expires_at: null,
        last_error: null,
        updated_at: currentTime(),
      })
      .where(
        and(
          eq(workerWarmPool.warm_pool_id, warmPoolId),
          eq(workerWarmPool.state, EWorkerWarmPoolState.deleting)
        )
      )
      .execute();

    return result.rowCount === 1;
  }

  async markAssigned(input: AssignWarmPoolRuntimeInput): Promise<boolean> {
    const result = await this.dbRw
      .update(workerWarmPool)
      .set({
        state: EWorkerWarmPoolState.assigned,
        container_id: input.assignedContainerId,
        container_name: input.assignedContainerName,
        reserved_by_worker_id: input.reservedByWorkerId,
        reservation_expires_at: null,
        updated_at: currentTime(),
      })
      .where(
        and(
          eq(workerWarmPool.warm_pool_id, input.warmPoolId),
          eq(workerWarmPool.state, EWorkerWarmPoolState.activating),
          eq(workerWarmPool.reserved_by_worker_id, input.reservedByWorkerId),
          eq(workerWarmPool.container_id, input.expectedContainerId)
        )
      )
      .execute();

    return result.rowCount === 1;
  }

  /**
   * Binds an immutable PostgreSQL warm-container identity to the reserved
   * channel. The worker row is locked first, followed by runtime and warm
   * state, matching the global lifecycle/session lock order. A redelivery
   * with the exact same identity is idempotent.
   */
  async bindPostgresWarmRuntime(
    input: BindPostgresWarmRuntimeInput
  ): Promise<boolean> {
    return this.dbRw.transaction(async (tx) => {
      const runtimeRetirementMarkerEmpty = and(
        isNull(workerRuntime.recreate_retired_operation_id),
        isNull(workerRuntime.recreate_retired_runtime_generation),
        isNull(workerRuntime.recreate_retired_container_id),
        isNull(workerRuntime.recreate_retired_at)
      );
      const runtimeIsCleanPreProviderActivation = and(
        isNull(workerRuntime.connection_epoch),
        eq(workerRuntime.connection_sequence, 0),
        isNull(workerRuntime.source_provider),
        isNull(workerRuntime.connection_activated_at),
        isNull(workerRuntime.native_connection_status),
        isNull(workerRuntime.native_connection_public_status),
        isNull(workerRuntime.native_connection_status_source_id),
        isNull(workerRuntime.native_connection_status_sequence),
        isNull(workerRuntime.native_connection_status_outbox_id),
        isNull(workerRuntime.native_connection_status_lease_owner_id),
        isNull(workerRuntime.native_connection_status_fencing_token),
        isNull(
          workerRuntime.native_connection_status_changed_at_high_watermark
        ),
        sql`cardinality(${workerRuntime.native_connection_status_retired_source_ids}) = 0`,
        eq(workerRuntime.native_connection_online_acknowledged, false),
        isNull(workerRuntime.recreate_bootstrap_operation_id),
        isNull(workerRuntime.recreate_bootstrap_runtime_generation),
        isNull(workerRuntime.recreate_bootstrap_container_id),
        isNull(workerRuntime.recreate_bootstrap_started_at)
      );
      const runtimeIsUnboundReservation = and(
        isNull(workerRuntime.container_id),
        isNull(workerRuntime.runtime_capability_hash),
        isNull(workerRuntime.session_writer_epoch),
        runtimeIsCleanPreProviderActivation
      );
      const runtimeIsExactBoundReplay = and(
        eq(workerRuntime.container_id, input.containerId),
        eq(workerRuntime.container_name, input.containerName),
        eq(workerRuntime.runtime_capability_hash, input.runtimeCapabilityHash),
        eq(workerRuntime.session_writer_epoch, input.writerEpoch),
        runtimeIsCleanPreProviderActivation
      );
      const runtimeIsBindable = and(
        runtimeRetirementMarkerEmpty,
        or(runtimeIsUnboundReservation, runtimeIsExactBoundReplay)
      );
      const [owner] = await tx
        .select({ worker_id: worker.worker_id })
        .from(worker)
        .where(
          and(
            eq(worker.worker_id, input.workerId),
            eq(worker.account_id, input.accountId),
            eq(worker.server_id, input.serverId),
            eq(worker.worker_type_id, input.workerTypeId),
            input.lifecycleOperationId
              ? eq(worker.lifecycle_operation_id, input.lifecycleOperationId)
              : isNull(worker.lifecycle_operation_id),
            inArray(worker.worker_status_id, [
              EWorkerStatus.creating,
              EWorkerStatus.recreating,
              EWorkerStatus.disponible,
              EWorkerStatus.online,
            ]),
            isNull(worker.deleted_at)
          )
        )
        .for('update')
        .limit(1)
        .execute();
      if (!owner) return false;

      const [runtime] = await tx
        .select({ worker_id: workerRuntime.worker_id })
        .from(workerRuntime)
        .where(
          and(
            eq(workerRuntime.worker_id, input.workerId),
            eq(workerRuntime.runtime_generation, input.runtimeGeneration),
            eq(workerRuntime.warm_pool_id, input.warmPoolId),
            eq(workerRuntime.session_storage, EWorkerSessionStorage.postgres),
            isNull(workerRuntime.session_volume_name),
            runtimeIsBindable
          )
        )
        .for('update')
        .limit(1)
        .execute();
      if (!runtime) return false;

      const [warm] = await tx
        .select({ warm_pool_id: workerWarmPool.warm_pool_id })
        .from(workerWarmPool)
        .where(
          and(
            eq(workerWarmPool.warm_pool_id, input.warmPoolId),
            eq(workerWarmPool.server_id, input.serverId),
            eq(workerWarmPool.worker_type_id, input.workerTypeId),
            eq(workerWarmPool.state, EWorkerWarmPoolState.activating),
            eq(workerWarmPool.reserved_by_worker_id, input.workerId),
            eq(workerWarmPool.container_id, input.containerId),
            eq(workerWarmPool.session_storage, EWorkerSessionStorage.postgres),
            isNull(workerWarmPool.session_volume_name),
            eq(
              workerWarmPool.runtime_capability_hash,
              input.runtimeCapabilityHash
            ),
            eq(workerWarmPool.session_writer_epoch, input.writerEpoch)
          )
        )
        .for('update')
        .limit(1)
        .execute();
      if (!warm) return false;

      const now = currentTime();
      const runtimeResult = await tx
        .update(workerRuntime)
        .set({
          container_id: input.containerId,
          container_name: input.containerName,
          runtime_capability_hash: input.runtimeCapabilityHash,
          session_writer_epoch: input.writerEpoch,
          activated_at: now,
          updated_at: now,
        })
        .where(
          and(
            eq(workerRuntime.worker_id, input.workerId),
            eq(workerRuntime.runtime_generation, input.runtimeGeneration),
            eq(workerRuntime.warm_pool_id, input.warmPoolId),
            eq(workerRuntime.session_storage, EWorkerSessionStorage.postgres),
            isNull(workerRuntime.session_volume_name),
            runtimeIsBindable
          )
        )
        .execute();
      if (runtimeResult.rowCount !== 1) {
        throw new Error('postgres_warm_runtime_bind_cas_failed');
      }

      const warmResult = await tx
        .update(workerWarmPool)
        .set({ runtime_generation: input.runtimeGeneration, updated_at: now })
        .where(
          and(
            eq(workerWarmPool.warm_pool_id, input.warmPoolId),
            eq(workerWarmPool.state, EWorkerWarmPoolState.activating),
            eq(workerWarmPool.reserved_by_worker_id, input.workerId),
            eq(workerWarmPool.container_id, input.containerId)
          )
        )
        .execute();
      if (warmResult.rowCount !== 1) {
        throw new Error('postgres_warm_identity_bind_cas_failed');
      }
      return true;
    });
  }

  async rejectActivation(
    input: RejectWarmPoolActivationInput
  ): Promise<boolean> {
    const result = await this.dbRw
      .update(workerWarmPool)
      .set({
        state: EWorkerWarmPoolState.error,
        last_error: input.error.slice(0, 1000),
        reservation_expires_at: null,
        updated_at: currentTime(),
      })
      .where(
        and(
          eq(workerWarmPool.warm_pool_id, input.warmPoolId),
          eq(workerWarmPool.state, EWorkerWarmPoolState.reserved),
          eq(workerWarmPool.reserved_by_worker_id, input.reservedByWorkerId)
        )
      )
      .execute();

    return result.rowCount === 1;
  }

  async releaseReservedAfterHealthFence(
    input: ReleaseReservedWarmPoolHealthFenceInput
  ): Promise<boolean> {
    const result = await this.dbRw
      .update(workerWarmPool)
      .set({
        state: EWorkerWarmPoolState.ready,
        reserved_by_worker_id: null,
        reservation_expires_at: null,
        last_health_at: null,
        last_error: 'warm_runtime_activation_health_fence_retry',
        updated_at: currentTime(),
      })
      .where(
        and(
          eq(workerWarmPool.warm_pool_id, input.warmPoolId),
          eq(workerWarmPool.state, EWorkerWarmPoolState.reserved),
          eq(workerWarmPool.reserved_by_worker_id, input.reservedByWorkerId),
          eq(workerWarmPool.container_id, input.expectedContainerId)
        )
      )
      .execute();

    return result.rowCount === 1;
  }

  async finalizeRejectedActivationCleanup(
    input: FinalizeRejectedWarmPoolActivationCleanupInput
  ): Promise<boolean> {
    const result = await this.dbRw
      .update(workerWarmPool)
      .set({
        state: EWorkerWarmPoolState.error,
        container_id: null,
        container_name: null,
        reserved_by_worker_id: null,
        reservation_expires_at: null,
        last_error: input.error.slice(0, 1000),
        updated_at: currentTime(),
      })
      .where(
        and(
          eq(workerWarmPool.warm_pool_id, input.warmPoolId),
          eq(workerWarmPool.state, EWorkerWarmPoolState.error),
          eq(workerWarmPool.reserved_by_worker_id, input.reservedByWorkerId),
          eq(workerWarmPool.container_id, input.expectedContainerId),
          eq(workerWarmPool.session_volume_name, input.sessionVolumeName)
        )
      )
      .execute();

    return result.rowCount === 1;
  }

  async extendActivationReservation(
    input: ExtendWarmPoolActivationReservationInput
  ): Promise<boolean> {
    const result = await this.dbRw
      .update(workerWarmPool)
      .set({
        reservation_expires_at: input.reservationExpiresAt,
        updated_at: currentTime(),
      })
      .where(
        and(
          eq(workerWarmPool.warm_pool_id, input.warmPoolId),
          eq(workerWarmPool.state, EWorkerWarmPoolState.reserved),
          eq(workerWarmPool.reserved_by_worker_id, input.reservedByWorkerId)
        )
      )
      .execute();

    return result.rowCount === 1;
  }

  async beginActivation(input: BeginWarmPoolActivationInput): Promise<boolean> {
    const result = await this.dbRw
      .update(workerWarmPool)
      .set({
        state: EWorkerWarmPoolState.activating,
        reservation_expires_at: null,
        updated_at: currentTime(),
      })
      .where(
        and(
          eq(workerWarmPool.warm_pool_id, input.warmPoolId),
          eq(workerWarmPool.state, EWorkerWarmPoolState.reserved),
          eq(workerWarmPool.reserved_by_worker_id, input.reservedByWorkerId),
          eq(workerWarmPool.container_id, input.expectedContainerId)
        )
      )
      .execute();

    return result.rowCount === 1;
  }

  async restorePreGenerationActivationToReady(
    input: RestorePreGenerationWarmPoolActivationInput
  ): Promise<boolean> {
    const result = await this.dbRw
      .update(workerWarmPool)
      .set({
        state: EWorkerWarmPoolState.ready,
        reserved_by_worker_id: null,
        reservation_expires_at: null,
        last_health_at: null,
        last_error: null,
        updated_at: currentTime(),
      })
      .where(
        and(
          eq(workerWarmPool.warm_pool_id, input.warmPoolId),
          eq(workerWarmPool.server_id, input.serverId),
          eq(workerWarmPool.worker_type_id, input.workerTypeId),
          eq(workerWarmPool.state, EWorkerWarmPoolState.activating),
          eq(workerWarmPool.reserved_by_worker_id, input.reservedByWorkerId),
          eq(workerWarmPool.container_id, input.expectedSourceContainerId),
          eq(workerWarmPool.container_name, input.expectedSourceContainerName),
          eq(workerWarmPool.session_volume_name, input.sessionVolumeName),
          notExists(
            this.dbRw
              .select({ worker_id: workerRuntime.worker_id })
              .from(workerRuntime)
              .where(
                or(
                  eq(workerRuntime.warm_pool_id, input.warmPoolId),
                  eq(
                    workerRuntime.container_id,
                    input.expectedSourceContainerId
                  ),
                  eq(
                    workerRuntime.container_name,
                    input.expectedSourceContainerName
                  ),
                  eq(workerRuntime.session_volume_name, input.sessionVolumeName)
                )
              )
          )
        )
      )
      .execute();

    return result.rowCount === 1;
  }

  async failActivatingActivation(
    input: FailActivatingWarmPoolActivationInput
  ): Promise<boolean> {
    const result = await this.dbRw
      .update(workerWarmPool)
      .set({
        state: EWorkerWarmPoolState.error,
        container_id: null,
        container_name: null,
        reserved_by_worker_id: null,
        reservation_expires_at: null,
        last_error: input.error.slice(0, 1000),
        updated_at: currentTime(),
      })
      .where(
        and(
          eq(workerWarmPool.warm_pool_id, input.warmPoolId),
          eq(workerWarmPool.state, EWorkerWarmPoolState.activating),
          eq(workerWarmPool.reserved_by_worker_id, input.reservedByWorkerId),
          eq(workerWarmPool.container_id, input.expectedSourceContainerId)
        )
      )
      .execute();

    return result.rowCount === 1;
  }

  async revertAssignedActivation(
    input: RevertAssignedWarmPoolActivationInput
  ): Promise<boolean> {
    const result = await this.dbRw
      .update(workerWarmPool)
      .set({
        state: EWorkerWarmPoolState.error,
        container_id: null,
        container_name: null,
        reserved_by_worker_id: null,
        reservation_expires_at: null,
        last_error: input.error.slice(0, 1000),
        updated_at: currentTime(),
      })
      .where(
        and(
          eq(workerWarmPool.warm_pool_id, input.warmPoolId),
          eq(workerWarmPool.state, EWorkerWarmPoolState.assigned),
          eq(workerWarmPool.reserved_by_worker_id, input.reservedByWorkerId),
          eq(workerWarmPool.container_id, input.containerId)
        )
      )
      .execute();

    return result.rowCount === 1;
  }

  /**
   * Claims a failed warm activation before any Docker mutation.
   *
   * Locking and changing the worker out of creating/recreating makes a
   * concurrent provider "online" CAS lose deterministically. The runtime and
   * warm rows are locked in the same transaction so the durable pending marker
   * can be redriven after a process crash without guessing physical identity.
   */
  async claimFailedActivationCleanup(
    input: ClaimFailedWarmActivationCleanupInput
  ): Promise<boolean> {
    return this.dbRw.transaction(async (tx) => {
      const [owner] = await tx
        .select({ worker_id: worker.worker_id })
        .from(worker)
        .where(
          and(
            eq(worker.worker_id, input.reservedByWorkerId),
            eq(worker.account_id, input.accountId),
            eq(worker.server_id, input.serverId),
            eq(worker.worker_type_id, input.workerTypeId),
            eq(worker.worker_status_id, input.expectedWorkerStatusId),
            input.lifecycleOperationId
              ? eq(worker.lifecycle_operation_id, input.lifecycleOperationId)
              : isNull(worker.lifecycle_operation_id),
            isNull(worker.deleted_at)
          )
        )
        .for('update')
        .limit(1)
        .execute();
      if (!owner) {
        return false;
      }

      const [runtime] = await tx
        .select({ worker_id: workerRuntime.worker_id })
        .from(workerRuntime)
        .where(
          and(
            eq(workerRuntime.worker_id, input.reservedByWorkerId),
            eq(workerRuntime.warm_pool_id, input.warmPoolId),
            eq(workerRuntime.runtime_generation, input.runtimeGeneration),
            eq(workerRuntime.container_id, input.runtimeContainerId),
            eq(workerRuntime.session_volume_name, input.sessionVolumeName)
          )
        )
        .for('update')
        .limit(1)
        .execute();
      if (!runtime) {
        return false;
      }

      const [warm] = await tx
        .select({ warm_pool_id: workerWarmPool.warm_pool_id })
        .from(workerWarmPool)
        .where(
          and(
            eq(workerWarmPool.warm_pool_id, input.warmPoolId),
            eq(workerWarmPool.server_id, input.serverId),
            eq(workerWarmPool.worker_type_id, input.workerTypeId),
            eq(workerWarmPool.state, input.expectedWarmState),
            eq(workerWarmPool.reserved_by_worker_id, input.reservedByWorkerId),
            eq(workerWarmPool.container_id, input.expectedWarmContainerId),
            eq(workerWarmPool.session_volume_name, input.sessionVolumeName)
          )
        )
        .for('update')
        .limit(1)
        .execute();
      if (!warm) {
        return false;
      }

      const ownerResult = await tx
        .update(worker)
        .set({
          worker_status_id: EWorkerStatus.error,
          updated_at: currentTime(),
        })
        .where(
          and(
            eq(worker.worker_id, input.reservedByWorkerId),
            eq(worker.account_id, input.accountId),
            eq(worker.server_id, input.serverId),
            eq(worker.worker_type_id, input.workerTypeId),
            eq(worker.worker_status_id, input.expectedWorkerStatusId),
            input.lifecycleOperationId
              ? eq(worker.lifecycle_operation_id, input.lifecycleOperationId)
              : isNull(worker.lifecycle_operation_id),
            isNull(worker.deleted_at)
          )
        )
        .execute();
      if (ownerResult.rowCount !== 1) {
        throw new Error('warm_activation_cleanup_worker_claim_failed');
      }

      const warmResult = await tx
        .update(workerWarmPool)
        .set({
          last_error: input.pendingError.slice(0, 1000),
          updated_at: currentTime(),
        })
        .where(
          and(
            eq(workerWarmPool.warm_pool_id, input.warmPoolId),
            eq(workerWarmPool.server_id, input.serverId),
            eq(workerWarmPool.worker_type_id, input.workerTypeId),
            eq(workerWarmPool.state, input.expectedWarmState),
            eq(workerWarmPool.reserved_by_worker_id, input.reservedByWorkerId),
            eq(workerWarmPool.container_id, input.expectedWarmContainerId),
            eq(workerWarmPool.session_volume_name, input.sessionVolumeName)
          )
        )
        .execute();
      if (warmResult.rowCount !== 1) {
        throw new Error('warm_activation_cleanup_warm_claim_failed');
      }

      return true;
    });
  }

  async finalizeFailedActivationCleanup(
    input: FinalizeFailedWarmActivationCleanupInput
  ): Promise<boolean> {
    return this.dbRw.transaction(async (tx) => {
      const [owner] = await tx
        .select({ worker_id: worker.worker_id })
        .from(worker)
        .where(
          and(
            eq(worker.worker_id, input.reservedByWorkerId),
            eq(worker.account_id, input.accountId),
            eq(worker.server_id, input.serverId),
            eq(worker.worker_type_id, input.workerTypeId),
            eq(worker.worker_status_id, EWorkerStatus.error),
            input.lifecycleOperationId
              ? eq(worker.lifecycle_operation_id, input.lifecycleOperationId)
              : isNull(worker.lifecycle_operation_id),
            isNull(worker.deleted_at)
          )
        )
        .for('update')
        .limit(1)
        .execute();
      if (!owner) {
        throw new Error('warm_activation_cleanup_worker_cas_failed');
      }

      const runtimeResult = await tx
        .update(workerRuntime)
        .set({
          container_id: null,
          container_name: input.reservedByWorkerId,
          session_volume_name: input.tombstoneSessionVolumeName.slice(0, 150),
          warm_pool_id: null,
          connection_epoch: null,
          connection_sequence: 0,
          source_provider: null,
          connection_activated_at: null,
          activated_at: null,
          updated_at: currentTime(),
        })
        .where(
          and(
            eq(workerRuntime.worker_id, input.reservedByWorkerId),
            eq(workerRuntime.warm_pool_id, input.warmPoolId),
            eq(workerRuntime.runtime_generation, input.runtimeGeneration),
            eq(workerRuntime.container_id, input.runtimeContainerId),
            eq(workerRuntime.session_volume_name, input.sessionVolumeName)
          )
        )
        .execute();
      if (runtimeResult.rowCount !== 1) {
        throw new Error('warm_activation_cleanup_runtime_cas_failed');
      }

      const warmResult = await tx
        .update(workerWarmPool)
        .set({
          state: EWorkerWarmPoolState.error,
          container_id: null,
          container_name: null,
          reserved_by_worker_id: null,
          reservation_expires_at: null,
          last_error: input.error.slice(0, 1000),
          updated_at: currentTime(),
        })
        .where(
          and(
            eq(workerWarmPool.warm_pool_id, input.warmPoolId),
            eq(workerWarmPool.state, input.expectedWarmState),
            eq(workerWarmPool.reserved_by_worker_id, input.reservedByWorkerId),
            eq(workerWarmPool.container_id, input.expectedWarmContainerId),
            eq(workerWarmPool.session_volume_name, input.sessionVolumeName),
            eq(workerWarmPool.last_error, input.pendingError)
          )
        )
        .execute();
      if (warmResult.rowCount !== 1) {
        throw new Error('warm_activation_cleanup_warm_cas_failed');
      }

      return true;
    });
  }

  async deleteById(warmPoolId: string): Promise<boolean> {
    const result = await this.dbRw
      .delete(workerWarmPool)
      .where(
        and(
          eq(workerWarmPool.warm_pool_id, warmPoolId),
          eq(workerWarmPool.state, EWorkerWarmPoolState.deleting)
        )
      )
      .execute();

    return result.rowCount === 1;
  }

  async deleteAssignedByWorkerId(
    workerId: string,
    exceptWarmPoolId?: string | null
  ): Promise<number> {
    const filters: SQLWrapper[] = [
      eq(workerWarmPool.state, EWorkerWarmPoolState.assigned),
      eq(workerWarmPool.reserved_by_worker_id, workerId),
      sql`NOT EXISTS (
        SELECT 1
        FROM "whatsapp_session_storage_migration" AS migration
        WHERE migration."source_volume_name" =
          ${workerWarmPool.session_volume_name}
          AND migration."source_volume_preserved" = true
          AND migration."state" <> 'completed'
      )`,
    ];

    if (exceptWarmPoolId) {
      filters.push(ne(workerWarmPool.warm_pool_id, exceptWarmPoolId));
    }

    const result = await this.dbRw
      .delete(workerWarmPool)
      .where(and(...filters))
      .execute();

    return result.rowCount ?? 0;
  }

  async releaseExpiredReservations(
    now: string = currentTime()
  ): Promise<number> {
    const result = await this.dbRw
      .update(workerWarmPool)
      .set({
        state: EWorkerWarmPoolState.ready,
        reserved_by_worker_id: null,
        reservation_expires_at: null,
        last_health_at: null,
        last_error: 'warm_runtime_reservation_expired_reprobe',
        updated_at: now,
      })
      .where(
        and(
          eq(workerWarmPool.state, EWorkerWarmPoolState.reserved),
          or(
            isNull(workerWarmPool.reservation_expires_at),
            lte(workerWarmPool.reservation_expires_at, now)
          ),
          notExists(
            this.dbRw
              .select({ worker_id: workerRuntime.worker_id })
              .from(workerRuntime)
              .where(
                or(
                  eq(workerRuntime.warm_pool_id, workerWarmPool.warm_pool_id),
                  and(
                    eq(workerRuntime.container_id, workerWarmPool.container_id),
                    sql`${workerWarmPool.container_id} IS NOT NULL`
                  ),
                  and(
                    eq(
                      workerRuntime.container_name,
                      workerWarmPool.container_name
                    ),
                    sql`${workerWarmPool.container_name} IS NOT NULL`
                  ),
                  eq(
                    workerRuntime.session_volume_name,
                    workerWarmPool.session_volume_name
                  )
                )
              )
          )
        )
      )
      .execute();

    return result.rowCount ?? 0;
  }

  async countAvailableByServerAndType(
    serverId: string,
    workerTypeId: string
  ): Promise<number> {
    const result = await this.dbRw.execute(sql`
      SELECT COUNT(*)::integer AS "value"
      FROM "worker_warm_pool" AS pool
      WHERE pool."server_id" = ${serverId}
        AND pool."worker_type_id" = ${workerTypeId}
        AND pool."session_storage" = ${EWorkerSessionStorage.postgres}
        AND pool."session_volume_name" IS NULL
        AND pool."state" IN (
          ${EWorkerWarmPoolState.warming},
          ${EWorkerWarmPoolState.ready}
        )
        AND NOT EXISTS (
          SELECT 1
          FROM "worker_runtime" AS runtime
          WHERE runtime."warm_pool_id" = pool."warm_pool_id"
            OR (
              pool."container_id" IS NOT NULL
              AND runtime."container_id" = pool."container_id"
            )
            OR (
              pool."container_name" IS NOT NULL
              AND runtime."container_name" = pool."container_name"
            )
            OR runtime."session_volume_name" = pool."session_volume_name"
        )
    `);
    const rows = (result as unknown as { rows?: Array<{ value: number }> })
      .rows;
    return Number(rows?.[0]?.value ?? 0);
  }
}
