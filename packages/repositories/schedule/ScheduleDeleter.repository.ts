import * as schema from '@core/models';
import { schedule, scheduledContact } from '@core/models';
import {
  NodePgDatabase,
  NodePgQueryResultHKT,
} from 'drizzle-orm/node-postgres';
import { inject, injectable } from 'tsyringe';
import { eq, ExtractTablesWithRelations } from 'drizzle-orm';
import { PgTransaction } from 'drizzle-orm/pg-core';

@injectable()
export class ScheduleDeleterRepository {
  constructor(
    @inject('Database') private readonly db: NodePgDatabase<typeof schema>
  ) {}

  private readonly deleteScheduledContacts = async (
    tx: PgTransaction<
      NodePgQueryResultHKT,
      typeof schema,
      ExtractTablesWithRelations<typeof schema>
    >,
    scheduleId: string
  ): Promise<void> => {
    await tx
      .delete(scheduledContact)
      .where(eq(scheduledContact.schedule_id, scheduleId))
      .execute();
  };

  private readonly deleteSchedule = async (
    tx: PgTransaction<
      NodePgQueryResultHKT,
      typeof schema,
      ExtractTablesWithRelations<typeof schema>
    >,
    scheduleId: string
  ): Promise<boolean> => {
    const result = await tx
      .delete(schedule)
      .where(eq(schedule.schedule_id, scheduleId))
      .execute();

    return result.rowCount === 1;
  };

  deleteScheduleById = async (scheduleId: string): Promise<boolean> => {
    return this.db.transaction(async (tx) => {
      await this.deleteScheduledContacts(tx, scheduleId);

      const scheduleDeleted = await this.deleteSchedule(tx, scheduleId);

      if (!scheduleDeleted) {
        return false;
      }

      return true;
    });
  };
}
