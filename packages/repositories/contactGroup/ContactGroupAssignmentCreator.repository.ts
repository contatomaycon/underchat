import * as schema from '@core/models';
import { contactGroupAssignment } from '@core/models';
import { ExtractTablesWithRelations } from 'drizzle-orm';
import {
  NodePgDatabase,
  NodePgQueryResultHKT,
} from 'drizzle-orm/node-postgres';
import { PgTransaction } from 'drizzle-orm/pg-core';
import { inject, injectable } from 'tsyringe';
import { v7 as uuidv7 } from 'uuid';

@injectable()
export class ContactGroupAssignmentCreatorRepository {
  constructor(
    @inject('DatabaseRw') private readonly dbRw: NodePgDatabase<typeof schema>
  ) {}

  createContactGroupAssignment = async (
    tx: PgTransaction<
      NodePgQueryResultHKT,
      typeof schema,
      ExtractTablesWithRelations<typeof schema>
    >,
    contactGroupId: string,
    contactId: string
  ): Promise<string | null> => {
    const contactGroupAssignmentId = uuidv7();

    const result = await tx
      .insert(contactGroupAssignment)
      .values({
        contact_group_assignment_id: contactGroupAssignmentId,
        contact_group_id: contactGroupId,
        contact_id: contactId,
      })
      .execute();

    if (!result) {
      return null;
    }

    return contactGroupAssignmentId;
  };
}
