import * as schema from '@core/models';
import { contactGroup } from '@core/models';
import {
  NodePgDatabase,
  NodePgQueryResultHKT,
} from 'drizzle-orm/node-postgres';
import { inject, injectable } from 'tsyringe';
import { v4 as uuidv4 } from 'uuid';
import { CreateContactGroupRequest } from '@core/schema/contactGroup/createContactGroup/request.schema';
import { PgTransaction } from 'drizzle-orm/pg-core';
import { ExtractTablesWithRelations } from 'drizzle-orm';

@injectable()
export class ContactGroupCreatorRepository {
  constructor(
    @inject('Database') private readonly db: NodePgDatabase<typeof schema>
  ) {}

  createContactGroup = async (
    tx: PgTransaction<
      NodePgQueryResultHKT,
      typeof schema,
      ExtractTablesWithRelations<typeof schema>
    >,
    input: CreateContactGroupRequest,
    accountId: string
  ): Promise<string | null> => {
    const contactGroupId = uuidv4();

    const result = await tx
      .insert(contactGroup)
      .values({
        contact_group_id: contactGroupId,
        account_id: accountId,
        name: input.name,
        description: input.description || null,
      })
      .execute();

    if (!result) {
      return null;
    }

    return contactGroupId;
  };
}
