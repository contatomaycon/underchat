import * as schema from '@core/models';
import { contactGroup } from '@core/models';
import {
  NodePgDatabase,
  NodePgQueryResultHKT,
} from 'drizzle-orm/node-postgres';
import { inject, injectable } from 'tsyringe';
import { eq, ExtractTablesWithRelations } from 'drizzle-orm';
import { currentTime } from '@core/common/functions/currentTime';
import { PgTransaction } from 'drizzle-orm/pg-core';

@injectable()
export class ContactGroupDeleterRepository {
  constructor(
    @inject('DatabaseRw') private readonly db: NodePgDatabase<typeof schema>
  ) {}

  deleteContactGroupById = async (
    tx: PgTransaction<
      NodePgQueryResultHKT,
      typeof schema,
      ExtractTablesWithRelations<typeof schema>
    >,
    contactGroupId: string
  ): Promise<boolean> => {
    const date = currentTime();

    const result = await tx
      .update(contactGroup)
      .set({
        deleted_at: date,
      })
      .where(eq(contactGroup.contact_group_id, contactGroupId))
      .execute();

    return result.rowCount === 1;
  };
}
