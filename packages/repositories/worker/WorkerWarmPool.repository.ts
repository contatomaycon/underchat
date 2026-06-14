import * as schema from '@core/models';
import { server, workerType, workerWarmPool } from '@core/models';
import { EWorkerWarmPoolState } from '@core/common/enums/EWorkerWarmPoolState';
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
  isNull,
  lte,
  ne,
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
  session_volume_name: string;
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

export interface MarkReadyWarmPoolExcessInput {
  serverId: string;
  workerTypeId: string;
  limit: number;
}

type WarmChannelFilters = Omit<
  ListWarmChannelsRequest,
  'current_page' | 'per_page' | 'sort_by'
>;

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
        session_volume_name: input.session_volume_name,
        state: input.state ?? EWorkerWarmPoolState.warming,
      })
      .onConflictDoNothing()
      .returning()
      .execute();

    if (result) {
      return result as IWorkerWarmPool;
    }

    const existing = await this.viewById(input.warm_pool_id);
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
      isNull(server.deleted_at),
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

  async listActiveByServer(serverId: string): Promise<IWorkerWarmPool[]> {
    const result = await this.dbRo
      .select()
      .from(workerWarmPool)
      .where(
        and(
          eq(workerWarmPool.server_id, serverId),
          inArray(workerWarmPool.state, [
            EWorkerWarmPoolState.warming,
            EWorkerWarmPoolState.ready,
            EWorkerWarmPoolState.reserved,
          ])
        )
      )
      .execute();

    return result as IWorkerWarmPool[];
  }

  async listReadyCounts(): Promise<IWorkerWarmPoolReadyCount[]> {
    const result = await this.dbRo
      .select({
        server_id: workerWarmPool.server_id,
        worker_type_id: workerWarmPool.worker_type_id,
        ready_count: count(workerWarmPool.warm_pool_id),
      })
      .from(workerWarmPool)
      .where(eq(workerWarmPool.state, EWorkerWarmPoolState.ready))
      .groupBy(workerWarmPool.server_id, workerWarmPool.worker_type_id)
      .execute();

    return result.map((item) => ({
      server_id: item.server_id,
      worker_type_id: item.worker_type_id,
      ready_count: Number(item.ready_count),
    }));
  }

  async markReadyExcessAsDeleting(
    input: MarkReadyWarmPoolExcessInput
  ): Promise<IWorkerWarmPool[]> {
    const parsedLimit = Number(input.limit);
    const limit = Number.isFinite(parsedLimit)
      ? Math.max(0, Math.floor(parsedLimit))
      : 0;
    if (limit === 0) {
      return [];
    }

    const now = currentTime();
    const result = await this.dbRw.execute(sql`
      WITH selected AS (
        SELECT "warm_pool_id"
        FROM "worker_warm_pool"
        WHERE "server_id" = ${input.serverId}
          AND "worker_type_id" = ${input.workerTypeId}
          AND "state" = ${EWorkerWarmPoolState.ready}
        ORDER BY "last_health_at" ASC NULLS FIRST, "created_at" ASC, "warm_pool_id" ASC
        LIMIT ${limit}
        FOR UPDATE SKIP LOCKED
      )
      UPDATE "worker_warm_pool"
      SET
        "state" = ${EWorkerWarmPoolState.deleting},
        "last_error" = 'warm_pool_excess',
        "updated_at" = ${now}
      FROM selected
      WHERE "worker_warm_pool"."warm_pool_id" = selected."warm_pool_id"
        AND "worker_warm_pool"."state" = ${EWorkerWarmPoolState.ready}
      RETURNING
        "worker_warm_pool"."warm_pool_id",
        "worker_warm_pool"."server_id",
        "worker_warm_pool"."worker_type_id",
        "worker_warm_pool"."container_id",
        "worker_warm_pool"."container_name",
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

  async reserveReady(
    serverId: string,
    workerTypeId: string,
    workerId: string,
    reservationExpiresAt: string
  ): Promise<IWorkerWarmPool | null> {
    const now = currentTime();

    return this.dbRw.transaction(async (tx) => {
      const selected = await tx.execute(sql`
        SELECT "warm_pool_id"
        FROM "worker_warm_pool"
        WHERE "server_id" = ${serverId}
          AND "worker_type_id" = ${workerTypeId}
          AND "state" = ${EWorkerWarmPoolState.ready}
          AND ("container_name" IS NULL OR "container_name" LIKE 'warm-%')
          AND NOT EXISTS (
            SELECT 1
            FROM "worker_runtime"
            WHERE "worker_runtime"."warm_pool_id" = "worker_warm_pool"."warm_pool_id"
              OR (
                "worker_warm_pool"."container_id" IS NOT NULL
                AND "worker_runtime"."container_id" = "worker_warm_pool"."container_id"
              )
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

  async markAssigned(warmPoolId: string, workerId: string): Promise<boolean> {
    const result = await this.dbRw
      .update(workerWarmPool)
      .set({
        state: EWorkerWarmPoolState.assigned,
        reserved_by_worker_id: workerId,
        reservation_expires_at: null,
        updated_at: currentTime(),
      })
      .where(
        and(
          eq(workerWarmPool.warm_pool_id, warmPoolId),
          eq(workerWarmPool.reserved_by_worker_id, workerId)
        )
      )
      .execute();

    return result.rowCount === 1;
  }

  async markDeleting(warmPoolId: string): Promise<boolean> {
    const result = await this.dbRw
      .update(workerWarmPool)
      .set({
        state: EWorkerWarmPoolState.deleting,
        updated_at: currentTime(),
      })
      .where(eq(workerWarmPool.warm_pool_id, warmPoolId))
      .execute();

    return result.rowCount === 1;
  }

  async deleteById(warmPoolId: string): Promise<boolean> {
    const result = await this.dbRw
      .delete(workerWarmPool)
      .where(eq(workerWarmPool.warm_pool_id, warmPoolId))
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
        updated_at: now,
      })
      .where(
        and(
          eq(workerWarmPool.state, EWorkerWarmPoolState.reserved),
          or(
            isNull(workerWarmPool.reservation_expires_at),
            lte(workerWarmPool.reservation_expires_at, now)
          )
        )
      )
      .execute();

    return result.rowCount ?? 0;
  }

  async countActiveByServerAndType(
    serverId: string,
    workerTypeId: string
  ): Promise<number> {
    const [result] = await this.dbRw
      .select({ value: count(workerWarmPool.warm_pool_id) })
      .from(workerWarmPool)
      .where(
        and(
          eq(workerWarmPool.server_id, serverId),
          eq(workerWarmPool.worker_type_id, workerTypeId),
          inArray(workerWarmPool.state, [
            EWorkerWarmPoolState.warming,
            EWorkerWarmPoolState.ready,
            EWorkerWarmPoolState.reserved,
          ])
        )
      )
      .execute();

    return Number(result?.value ?? 0);
  }
}
