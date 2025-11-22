import { ICreateContact } from '@core/common/interfaces/ICreateContact';
import * as schema from '@core/models';
import { contact } from '@core/models';
import { NodePgDatabase } from 'drizzle-orm/node-postgres';
import { inject, injectable } from 'tsyringe';
import { v7 as uuidv7 } from 'uuid';
import { nullIfEmpty } from '@core/common/functions/nullIfEmpty';

@injectable()
export class ContactCreatorRepository {
  constructor(
    @inject('Database') private readonly db: NodePgDatabase<typeof schema>
  ) {}

  createContact = async (input: ICreateContact): Promise<string | null> => {
    const contactId = uuidv7();

    const result = await this.db
      .insert(contact)
      .values({
        contact_id: contactId,
        account_id: input.account_id,
        label_template_id: input.label_template_id,
        name: input.name,
        last_name: input.last_name,
        email: input.email,
        email_partial: input.email_partial,
        email_c: input.email_c,
        phone_ddi: input.phone_ddi,
        phone: input.phone,
        phone_partial: input.phone_partial,
        phone_c: input.phone_c,
        nickname: input.nickname,
        birthday: nullIfEmpty(input.birthday),
        notes: input.notes,
      })
      .execute();

    if (!result) return null;

    return contactId;
  };
}
