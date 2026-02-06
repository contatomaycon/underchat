import * as schema from '@core/models';
import { contactGroupAssignment } from '@core/models';
import {
  NodePgDatabase,
  NodePgQueryResultHKT,
} from 'drizzle-orm/node-postgres';
import { inject, injectable } from 'tsyringe';
import { and, count, eq, ExtractTablesWithRelations } from 'drizzle-orm';
import { PgTransaction } from 'drizzle-orm/pg-core';

@injectable()
export class ContactGroupAssignmentViewerExistsRepository {
  constructor(
    @inject('DatabaseRo') private readonly dbRo: NodePgDatabase<typeof schema>
  ) {}

  existsContactGroupAssignmentByContactAndGroup = async (
    contactGroupId: string,
    contactId: string
  ): Promise<boolean> => {
    const result = await this.dbRo
      .select({
        total: count(),
      })
      .from(contactGroupAssignment)
      .where(
        and(
          eq(contactGroupAssignment.contact_group_id, contactGroupId),
          eq(contactGroupAssignment.contact_id, contactId)
        )
      )
      .execute();

    if (!result.length) {
      return false;
    }

    return result[0].total > 0;
  };

  existsContactGroupAssignmentById = async (
    tx: PgTransaction<
      NodePgQueryResultHKT,
      typeof schema,
      ExtractTablesWithRelations<typeof schema>
    >,
    contactGroupId: string
  ): Promise<boolean> => {
    const result = await tx
      .select({
        total: count(),
      })
      .from(contactGroupAssignment)
      .where(eq(contactGroupAssignment.contact_group_id, contactGroupId))
      .execute();

    if (!result.length) {
      return false;
    }

    return result[0].total > 0;
  };
}
