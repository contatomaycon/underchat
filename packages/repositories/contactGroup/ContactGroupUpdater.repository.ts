import * as schema from '@core/models';
import { contactGroup } from '@core/models';
import {
  NodePgDatabase,
  NodePgQueryResultHKT,
} from 'drizzle-orm/node-postgres';
import { inject, injectable } from 'tsyringe';
import { eq, ExtractTablesWithRelations } from 'drizzle-orm';
import { UpdateContactGroupRequest } from '@core/schema/contactGroup/editContactGroup/request.schema';
import { PgTransaction } from 'drizzle-orm/pg-core';

@injectable()
export class ContactGroupUpdaterRepository {
  constructor(
    @inject('Database') private readonly db: NodePgDatabase<typeof schema>
  ) {}

  private updateInput(
    input: UpdateContactGroupRequest
  ): Partial<typeof contactGroup.$inferInsert> {
    const inputUpdate: Partial<typeof contactGroup.$inferInsert> = {};

    if (input?.name) {
      inputUpdate.name = input.name;
    }

    if (input?.description) {
      inputUpdate.description = input.description;
    }

    return inputUpdate;
  }

  updateContactGroupById = async (
    tx: PgTransaction<
      NodePgQueryResultHKT,
      typeof schema,
      ExtractTablesWithRelations<typeof schema>
    >,
    contactGroupId: string,
    input: UpdateContactGroupRequest
  ): Promise<boolean> => {
    const updateInput = this.updateInput(input);

    const result = await tx
      .update(contactGroup)
      .set(updateInput)
      .where(eq(contactGroup.contact_group_id, contactGroupId))
      .execute();

    return result.rowCount === 1;
  };
}
