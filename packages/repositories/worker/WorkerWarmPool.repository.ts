import * as schema from '@core/models';
import { workerWarmPool } from '@core/models';
import { EWorkerWarmPoolState } from '@core/common/enums/EWorkerWarmPoolState';
import {
  IWorkerWarmPool,
  IWorkerWarmPoolReadyCount,
} from '@core/common/interfaces/IWorkerWarmPool';
import { currentTime } from '@core/common/functions/currentTime';
import { NodePgDatabase } from 'drizzle-orm/node-postgres';
import { inject, injectable } from 'tsyringe';
import { and, count, eq, inArray, isNull, lte, or, sql } from 'drizzle-orm';

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
    const [result] = await this.dbRo
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
