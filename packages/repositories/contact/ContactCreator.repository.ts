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
import { EContactIgnore } from '@core/common/enums/EContactIgnore';

@injectable()
export class ContactCreatorRepository {
  constructor(
    @inject('DatabaseRw') private readonly dbRw: NodePgDatabase<typeof schema>,
    private readonly contactGroupAssignmentCreatorRepository: ContactGroupAssignmentCreatorRepository
  ) {}

  private truncateField(
    value: string | null | undefined,
    maxLength: number
  ): string | null {
    if (!value) return null;
    if (value.length <= maxLength) return value;
    return value.slice(0, maxLength);
  }

  private validateAndTruncateContact(input: ICreateContact): ICreateContact {
    return {
      ...input,
      name: this.truncateField(input.name, 100) ?? '',
      last_name: this.truncateField(input.last_name, 100),
      email: this.truncateField(input.email, 500),
      email_partial: this.truncateField(input.email_partial, 50),
      email_c: this.truncateField(input.email_c, 500),
      phone_ddi: this.truncateField(input.phone_ddi, 5),
      phone: this.truncateField(input.phone, 500),
      phone_partial: this.truncateField(input.phone_partial, 15),
      phone_c: this.truncateField(input.phone_c, 500),
      nickname: this.truncateField(input.nickname, 100),
      photo: this.truncateField(input.photo, 500),
      document: this.truncateField(input.document, 500),
      document_partial: this.truncateField(input.document_partial, 20),
      document_c: this.truncateField(input.document_c, 500),
    };
  }

  createContact = async (
    input: ICreateContact,
    tx?: PgTransaction<
      NodePgQueryResultHKT,
      typeof schema,
      ExtractTablesWithRelations<typeof schema>
    >
  ): Promise<string | null> => {
    const validatedInput = this.validateAndTruncateContact(input);
    const contactId = uuidv7();

    const dbOrTx = tx || this.dbRw;

    try {
      const result = await dbOrTx
        .insert(contact)
        .values({
          contact_id: contactId,
          account_id: validatedInput.account_id,
          label_template_id: validatedInput.label_template_id,
          contact_document_type_id: validatedInput.contact_document_type_id,
          is_valided: validatedInput.is_valided ?? false,
          name: validatedInput.name,
          last_name: validatedInput.last_name,
          email: validatedInput.email,
          email_partial: validatedInput.email_partial,
          email_c: validatedInput.email_c,
          phone_ddi: validatedInput.phone_ddi,
          phone: validatedInput.phone,
          phone_partial: validatedInput.phone_partial,
          phone_c: validatedInput.phone_c,
          nickname: validatedInput.nickname,
          photo: validatedInput.photo,
          birthday: nullIfEmpty(validatedInput.birthday),
          notes: validatedInput.notes,
          document: validatedInput.document,
          document_partial: validatedInput.document_partial,
          document_c: validatedInput.document_c,
          user_id: validatedInput.user_id,
          ignore:
            (validatedInput.ignore as EContactIgnore) ??
            (EContactIgnore.not_ignore as EContactIgnore),
        })
        .execute();

      if (!result) return null;

      return contactId;
    } catch (error) {
      const pgError = error as { code?: string; message?: string };
      if (pgError.code === '22001') {
        return null;
      }
      throw error;
    }
  };

  createContactWithGroup = async (
    t: TFunction<'translation', undefined>,
    input: ICreateContact,
    contactGroupId: string | null
  ): Promise<boolean | null> => {
    try {
      return await this.dbRw.transaction(async (tx) => {
        const contactId = await this.createContact(input, tx);

        if (!contactId) {
          return null;
        }

        if (contactGroupId && contactGroupId.trim() !== '') {
          const contactGroupAssignmentId =
            await this.contactGroupAssignmentCreatorRepository.createContactGroupAssignment(
              tx,
              contactGroupId,
              contactId
            );

          if (!contactGroupAssignmentId) {
            return null;
          }
        }

        return true;
      });
    } catch (error) {
      const pgError = error as { code?: string; message?: string };
      if (pgError.code === '22001') {
        return null;
      }
      throw error;
    }
  };
}
