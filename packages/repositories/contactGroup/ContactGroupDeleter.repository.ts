import * as schema from '@core/models';
import { contactGroup } from '@core/models';
import {
  NodePgDatabase,
  NodePgQueryResultHKT,
} from 'drizzle-orm/node-postgres';
import { inject, injectable } from 'tsyringe';
import { and, eq, ExtractTablesWithRelations, isNull } from 'drizzle-orm';
import { currentTime } from '@core/common/functions/currentTime';
import { PgTransaction } from 'drizzle-orm/pg-core';

@injectable()
export class ContactGroupDeleterRepository {
  constructor(
    @inject('DatabaseRw') private readonly dbRw: NodePgDatabase<typeof schema>
  ) {}

  deleteContactGroupById = async (
    tx: PgTransaction<
      NodePgQueryResultHKT,
      typeof schema,
      ExtractTablesWithRelations<typeof schema>
    >,
    contactGroupId: string,
    accountId: string
  ): Promise<boolean> => {
    const date = currentTime();

    const result = await tx
      .update(contactGroup)
      .set({
        deleted_at: date,
      })
      .where(
        and(
          eq(contactGroup.contact_group_id, contactGroupId),
          eq(contactGroup.account_id, accountId),
          isNull(contactGroup.deleted_at)
        )
      )
      .execute();

    return result.rowCount === 1;
  };
}
