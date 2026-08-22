import * as schema from '@core/models';
import { contactGroupAssignment } from '@core/models';
import {
  NodePgDatabase,
  NodePgQueryResultHKT,
} from 'drizzle-orm/node-postgres';
import { inject, injectable } from 'tsyringe';
import { and, eq, ExtractTablesWithRelations } from 'drizzle-orm';
import { PgTransaction } from 'drizzle-orm/pg-core';

@injectable()
export class ContactGroupAssignmentDeleterRepository {
  constructor(
    @inject('DatabaseRw') private readonly dbRw: NodePgDatabase<typeof schema>
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

  deleteContactGroupAssignmentByGroupAndContact = async (
    tx: PgTransaction<
      NodePgQueryResultHKT,
      typeof schema,
      ExtractTablesWithRelations<typeof schema>
    >,
    contactGroupId: string,
    contactId: string
  ): Promise<boolean> => {
    const result = await tx
      .delete(contactGroupAssignment)
      .where(
        and(
          eq(contactGroupAssignment.contact_group_id, contactGroupId),
          eq(contactGroupAssignment.contact_id, contactId)
        )
      )
      .execute();

    return (result.rowCount ?? 0) === 1;
  };
}
