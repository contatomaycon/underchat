import { ICreateContact } from '@core/common/interfaces/ICreateContact';
import * as schema from '@core/models';
import { contact } from '@core/models';
import { ExtractTablesWithRelations } from 'drizzle-orm';
import {
  NodePgDatabase,
  NodePgQueryResultHKT,
} from 'drizzle-orm/node-postgres';
import { PgTransaction } from 'drizzle-orm/pg-core';
import { inject, injectable } from 'tsyringe';
import { v7 as uuidv7 } from 'uuid';
import { nullIfEmpty } from '@core/common/functions/nullIfEmpty';
import { ContactGroupAssignmentCreatorRepository } from '../contactGroup/ContactGroupAssignmentCreator.repository';
import { TFunction } from 'i18next';

@injectable()
export class ContactCreatorRepository {
  constructor(
    @inject('DatabaseRw') private readonly dbRw: NodePgDatabase<typeof schema>,
    private readonly contactGroupAssignmentCreatorRepository: ContactGroupAssignmentCreatorRepository
  ) {}

  createContact = async (
    input: ICreateContact,
    tx?: PgTransaction<
      NodePgQueryResultHKT,
      typeof schema,
      ExtractTablesWithRelations<typeof schema>
    >
  ): Promise<string | null> => {
    const contactId = uuidv7();

    const dbOrTx = tx || this.dbRw;

    const result = await dbOrTx
      .insert(contact)
      .values({
        contact_id: contactId,
        account_id: input.account_id,
        label_template_id: input.label_template_id,
        is_valided: input.is_valided ?? false,
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
        photo: input.photo,
        birthday: nullIfEmpty(input.birthday),
        notes: input.notes,
      })
      .execute();

    if (!result) return null;

    return contactId;
  };

  createContactWithGroup = async (
    t: TFunction<'translation', undefined>,
    input: ICreateContact,
    contactGroupId: string
  ): Promise<boolean | null> => {
    return this.dbRw.transaction(async (tx) => {
      const contactId = await this.createContact(input, tx);

      if (!contactId) {
        throw new Error(t('contact_creation_failed'));
      }

      if (contactGroupId) {
        const contactGroupAssignmentId =
          await this.contactGroupAssignmentCreatorRepository.createContactGroupAssignment(
            tx,
            contactGroupId,
            contactId
          );

        if (!contactGroupAssignmentId) {
          throw new Error(t('contact_group_assignment_creation_failed'));
        }
      }

      return true;
    });
  };
}
