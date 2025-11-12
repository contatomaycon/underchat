import * as schema from '@core/models';
import { contactGroupAssignment } from '@core/models';
import {
  NodePgDatabase,
  NodePgQueryResultHKT,
} from 'drizzle-orm/node-postgres';
import { inject, injectable } from 'tsyringe';
import { eq, ExtractTablesWithRelations } from 'drizzle-orm';
import { PgTransaction } from 'drizzle-orm/pg-core';

@injectable()
export class ContactGroupAssignmentDeleterRepository {
  constructor(
    @inject('Database') private readonly db: NodePgDatabase<typeof schema>
  ) {}

  deleteContactGroupAssignmentById = async (
    tx: PgTransaction<
      NodePgQueryResultHKT,
      typeof schema,
      ExtractTablesWithRelations<typeof schema>
    >,
    contactGroupId: string
  ): Promise<boolean> => {
    const result = await tx
      .delete(contactGroupAssignment)
      .where(eq(contactGroupAssignment.contact_group_id, contactGroupId))
      .execute();

    return (result.rowCount ?? 0) > 0;
  };
}
