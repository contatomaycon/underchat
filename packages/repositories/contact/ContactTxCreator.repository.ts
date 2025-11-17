import { ICreateContact } from '@core/common/interfaces/ICreateContact';
import * as schema from '@core/models';
import { contact } from '@core/models';
import { ExtractTablesWithRelations } from 'drizzle-orm';
import { NodePgQueryResultHKT } from 'drizzle-orm/node-postgres';
import { PgTransaction } from 'drizzle-orm/pg-core';
import { injectable } from 'tsyringe';
import { v7 as uuidv7 } from 'uuid';

@injectable()
export class ContactTxCreatorRepository {
  createContact = async (
    tx: PgTransaction<
      NodePgQueryResultHKT,
      typeof schema,
      ExtractTablesWithRelations<typeof schema>
    >,
    input: ICreateContact
  ): Promise<string | null> => {
    const contactId = uuidv7();

    const result = await tx
      .insert(contact)
      .values({
        contact_id: contactId,
        account_id: input.account_id,
        label_template_id: input.label_template_id,
        name: input.name,
        last_name: input.last_name,
        email: input.email,
        email_partial: input.email_partial,
        phone_ddi: input.phone_ddi,
        phone: input.phone,
        phone_partial: input.phone_partial,
        nickname: input.nickname,
        birthday: input.birthday,
        notes: input.notes,
      })
      .execute();

    if (!result) {
      return null;
    }

    return contactId;
  };
}
