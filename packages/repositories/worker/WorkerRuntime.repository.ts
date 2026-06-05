import * as schema from '@core/models';
import { workerRuntime } from '@core/models';
import { IWorkerRuntime } from '@core/common/interfaces/IWorkerRuntime';
import { currentTime } from '@core/common/functions/currentTime';
import { NodePgDatabase } from 'drizzle-orm/node-postgres';
import { inject, injectable } from 'tsyringe';
import { eq, sql } from 'drizzle-orm';

export interface UpsertWorkerRuntimeInput {
  worker_id: string;
  container_id?: string | null;
  container_name?: string | null;
  session_volume_name: string;
  runtime_generation?: number;
  warm_pool_id?: string | null;
  activated_at?: string | null;
}

@injectable()
export class WorkerRuntimeRepository {
  constructor(
    @inject('DatabaseRw') private readonly dbRw: NodePgDatabase<typeof schema>,
    @inject('DatabaseRo') private readonly dbRo: NodePgDatabase<typeof schema>
  ) {}

  async viewByWorkerId(workerId: string): Promise<IWorkerRuntime | null> {
    const result = await this.dbRo
      .select()
      .from(workerRuntime)
      .where(eq(workerRuntime.worker_id, workerId))
      .limit(1)
      .execute();

    return (result[0] as IWorkerRuntime | undefined) ?? null;
  }

  async resolveSessionVolumeName(workerId: string): Promise<string> {
    const runtime = await this.viewByWorkerId(workerId);
    return runtime?.session_volume_name || workerId;
  }

  async upsert(input: UpsertWorkerRuntimeInput): Promise<IWorkerRuntime> {
    const now = currentTime();
    const [result] = await this.dbRw
      .insert(workerRuntime)
      .values({
        worker_id: input.worker_id,
        container_id: input.container_id,
        container_name: input.container_name,
        session_volume_name: input.session_volume_name,
        runtime_generation: input.runtime_generation ?? 1,
        warm_pool_id: input.warm_pool_id,
        activated_at: input.activated_at ?? now,
        updated_at: now,
      })
      .onConflictDoUpdate({
        target: workerRuntime.worker_id,
        set: {
          container_id: input.container_id,
          container_name: input.container_name,
          session_volume_name: input.session_volume_name,
          runtime_generation:
            input.runtime_generation ??
            sql`${workerRuntime.runtime_generation} + 1`,
          warm_pool_id: input.warm_pool_id,
          activated_at: input.activated_at ?? now,
          updated_at: now,
        },
      })
      .returning()
      .execute();

    return result as IWorkerRuntime;
  }

  async deleteByWorkerId(workerId: string): Promise<boolean> {
    const result = await this.dbRw
      .delete(workerRuntime)
      .where(eq(workerRuntime.worker_id, workerId))
      .execute();

    return result.rowCount === 1;
  }
}
