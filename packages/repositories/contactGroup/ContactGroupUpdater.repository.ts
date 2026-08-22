import * as schema from '@core/models';
import { contactGroup } from '@core/models';
import {
  NodePgDatabase,
  NodePgQueryResultHKT,
} from 'drizzle-orm/node-postgres';
import { inject, injectable } from 'tsyringe';
import { and, eq, ExtractTablesWithRelations, isNull } from 'drizzle-orm';
import { UpdateContactGroupRequest } from '@core/schema/contactGroup/editContactGroup/request.schema';
import { PgTransaction } from 'drizzle-orm/pg-core';

@injectable()
export class ContactGroupUpdaterRepository {
  constructor(
    @inject('DatabaseRw') private readonly dbRw: NodePgDatabase<typeof schema>
  ) {}

  private updateInput(
    input: UpdateContactGroupRequest
  ): Partial<typeof contactGroup.$inferInsert> {
    const inputUpdate: Partial<typeof contactGroup.$inferInsert> = {};

    if (input.name !== undefined && input.name !== null && input.name !== '') {
      inputUpdate.name = input.name;
    }

    if (input.description !== undefined) {
      inputUpdate.description = input.description ?? null;
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
    input: UpdateContactGroupRequest,
    accountId: string
  ): Promise<boolean> => {
    const updateInput = this.updateInput(input);

    // Membership-only updates do not need to touch the group row. Drizzle
    // rejects an empty SET and updating `updated_at` would manufacture a
    // metadata mutation that is not part of the request.
    if (Object.keys(updateInput).length === 0) {
      return true;
    }

    const result = await tx
      .update(contactGroup)
      .set(updateInput)
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
