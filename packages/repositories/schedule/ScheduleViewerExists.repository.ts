import * as schema from '@core/models';
import { schedule } from '@core/models';
import { NodePgDatabase } from 'drizzle-orm/node-postgres';
import { inject, injectable } from 'tsyringe';
import { eq } from 'drizzle-orm';

@injectable()
export class ScheduleViewerExistsRepository {
  constructor(
    @inject('DatabaseRo') private readonly dbRo: NodePgDatabase<typeof schema>
  ) {}

  existsScheduleById = async (scheduleId: string): Promise<boolean> => {
    const result = await this.dbRo
      .select({
        schedule_id: schedule.schedule_id,
      })
      .from(schedule)
      .where(eq(schedule.schedule_id, scheduleId))
      .limit(1)
      .execute();

    return result.length > 0;
  };
}
