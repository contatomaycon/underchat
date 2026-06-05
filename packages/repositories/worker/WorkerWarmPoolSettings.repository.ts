import * as schema from '@core/models';
import { workerWarmPoolSettings } from '@core/models';
import {
  IWorkerWarmPoolSettings,
  IWorkerWarmPoolSettingsInput,
} from '@core/common/interfaces/IWorkerWarmPoolSettings';
import { currentTime } from '@core/common/functions/currentTime';
import { NodePgDatabase } from 'drizzle-orm/node-postgres';
import { inject, injectable } from 'tsyringe';
import { eq } from 'drizzle-orm';

export const WORKER_WARM_POOL_SETTINGS_ID = 'default';

@injectable()
export class WorkerWarmPoolSettingsRepository {
  constructor(
    @inject('DatabaseRw') private readonly dbRw: NodePgDatabase<typeof schema>,
    @inject('DatabaseRo') private readonly dbRo: NodePgDatabase<typeof schema>
  ) {}

  async view(): Promise<IWorkerWarmPoolSettings | null> {
    const result = await this.dbRo
      .select()
      .from(workerWarmPoolSettings)
      .where(
        eq(workerWarmPoolSettings.settings_id, WORKER_WARM_POOL_SETTINGS_ID)
      )
      .limit(1)
      .execute();

    return (result[0] as IWorkerWarmPoolSettings | undefined) ?? null;
  }

  async createDefaults(
    input: IWorkerWarmPoolSettingsInput
  ): Promise<IWorkerWarmPoolSettings> {
    const [result] = await this.dbRw
      .insert(workerWarmPoolSettings)
      .values({
        settings_id: WORKER_WARM_POOL_SETTINGS_ID,
        ...input,
      })
      .onConflictDoNothing()
      .returning()
      .execute();

    if (result) {
      return result as IWorkerWarmPoolSettings;
    }

    const current = await this.view();
    if (!current) {
      throw new Error('Warm pool settings were not created.');
    }

    return current;
  }

  async upsert(
    input: IWorkerWarmPoolSettingsInput
  ): Promise<IWorkerWarmPoolSettings> {
    const now = currentTime();
    const [result] = await this.dbRw
      .insert(workerWarmPoolSettings)
      .values({
        settings_id: WORKER_WARM_POOL_SETTINGS_ID,
        ...input,
        updated_at: now,
      })
      .onConflictDoUpdate({
        target: workerWarmPoolSettings.settings_id,
        set: {
          ...input,
          updated_at: now,
        },
      })
      .returning()
      .execute();

    return result as IWorkerWarmPoolSettings;
  }
}
