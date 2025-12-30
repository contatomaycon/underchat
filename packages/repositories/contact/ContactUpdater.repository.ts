import * as schema from '@core/models';
import { contact } from '@core/models';
import { NodePgDatabase } from 'drizzle-orm/node-postgres';
import { inject, injectable } from 'tsyringe';
import { eq } from 'drizzle-orm';
import { IUpdateContact } from '@core/common/interfaces/IUpdateContact';
import { nullIfEmpty } from '@core/common/functions/nullIfEmpty';

@injectable()
export class ContactUpdaterRepository {
  constructor(
    @inject('DatabaseRw') private readonly db: NodePgDatabase<typeof schema>
  ) {}

  private updateInput(
    input: IUpdateContact
  ): Partial<typeof contact.$inferInsert> {
    const inputUpdate: Partial<typeof contact.$inferInsert> = {};

    if ('label_template_id' in input) {
      inputUpdate.label_template_id = input.label_template_id ?? null;
    }

    if (input?.name) {
      inputUpdate.name = input.name;
    }

    if (input.last_name) {
      inputUpdate.last_name = input.last_name;
    }

    if (input.email && input.email_partial) {
      inputUpdate.email = input.email;
      inputUpdate.email_partial = input.email_partial;
      inputUpdate.email_c = input.email_c ?? null;
    }

    if (input.phone_ddi) {
      inputUpdate.phone_ddi = input.phone_ddi;
    }

    if (input.phone && input.phone_partial) {
      inputUpdate.phone = input.phone;
      inputUpdate.phone_partial = input.phone_partial;
      inputUpdate.phone_c = input.phone_c ?? null;
    }

    if (input.nickname) {
      inputUpdate.nickname = input.nickname;
    }

    if (input.birthday !== undefined) {
      inputUpdate.birthday = nullIfEmpty(input.birthday);
    }

    if (input.notes) {
      inputUpdate.notes = input.notes;
    }

    if (input.photo !== undefined) {
      inputUpdate.photo = input.photo;
    }

    inputUpdate.is_valided = input.is_valided ?? false;

    return inputUpdate;
  }

  updateContactById = async (
    contactId: string,
    input: IUpdateContact
  ): Promise<boolean> => {
    const updateInput = this.updateInput(input);

    const result = await this.db
      .update(contact)
      .set(updateInput)
      .where(eq(contact.contact_id, contactId))
      .execute();

    return result.rowCount === 1;
  };

  validateContact = async (
    contactId: string,
    input: IUpdateContact
  ): Promise<boolean> => {
    const updateInput: Partial<typeof contact.$inferInsert> = {
      phone_ddi: input.phone_ddi ?? undefined,
      phone: input.phone ?? undefined,
      phone_partial: input.phone_partial ?? undefined,
      phone_c: input.phone_c ?? undefined,
      is_valided: true,
    };

    const result = await this.db
      .update(contact)
      .set(updateInput)
      .where(eq(contact.contact_id, contactId))
      .execute();

    return result.rowCount === 1;
  };

  updateContactIsValided = async (
    contactId: string,
    isValided: boolean
  ): Promise<boolean> => {
    const result = await this.db
      .update(contact)
      .set({ is_valided: isValided })
      .where(eq(contact.contact_id, contactId))
      .execute();

    return result.rowCount === 1;
  };
}
