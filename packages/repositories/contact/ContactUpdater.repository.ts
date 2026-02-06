import * as schema from '@core/models';
import { contact } from '@core/models';
import {
  NodePgDatabase,
  NodePgQueryResultHKT,
} from 'drizzle-orm/node-postgres';
import { inject, injectable } from 'tsyringe';
import { eq, ExtractTablesWithRelations } from 'drizzle-orm';
import { PgTransaction } from 'drizzle-orm/pg-core';
import { IUpdateContact } from '@core/common/interfaces/IUpdateContact';
import { nullIfEmpty } from '@core/common/functions/nullIfEmpty';
import { EContactIgnore } from '@core/common/enums/EContactIgnore';
import { ContactLabelTemplateDeleterRepository } from './ContactLabelTemplateDeleter.repository';
import { ContactLabelTemplateCreatorRepository } from './ContactLabelTemplateCreator.repository';
import { ContactChannelsUpdaterTransactionRepository } from './ContactChannelsUpdaterTransaction.repository';

@injectable()
export class ContactUpdaterRepository {
  constructor(
    @inject('DatabaseRw') private readonly dbRw: NodePgDatabase<typeof schema>,
    private readonly contactLabelTemplateDeleterRepository: ContactLabelTemplateDeleterRepository,
    private readonly contactLabelTemplateCreatorRepository: ContactLabelTemplateCreatorRepository,
    private readonly contactChannelsUpdaterTransactionRepository: ContactChannelsUpdaterTransactionRepository
  ) {}

  private updateInput(
    input: IUpdateContact
  ): Partial<typeof contact.$inferInsert> {
    const inputUpdate: Partial<typeof contact.$inferInsert> = {};

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

    if ('contact_document_type_id' in input) {
      inputUpdate.contact_document_type_id =
        input.contact_document_type_id ?? null;
    }

    if ('document' in input) {
      inputUpdate.document = input.document ?? null;
      inputUpdate.document_partial = input.document_partial ?? null;
      inputUpdate.document_c = input.document_c ?? null;
    }

    if (input.user_id !== undefined) {
      inputUpdate.user_id = input.user_id ?? null;
    }

    if (input.ignore !== undefined) {
      inputUpdate.ignore =
        input.ignore !== null ? (input.ignore as EContactIgnore) : null;
    }

    inputUpdate.is_valided = input.is_valided ?? false;

    return inputUpdate;
  }

  private syncLabelTemplatesInTransaction = async (
    tx: PgTransaction<
      NodePgQueryResultHKT,
      typeof schema,
      ExtractTablesWithRelations<typeof schema>
    >,
    contactId: string,
    labelTemplateIds: string[]
  ): Promise<void> => {
    await this.contactLabelTemplateDeleterRepository.deleteContactLabelTemplatesByContactId(
      tx,
      contactId
    );

    if (labelTemplateIds.length > 0) {
      await Promise.all(
        labelTemplateIds.map((labelTemplateId) =>
          this.contactLabelTemplateCreatorRepository.createContactLabelTemplate(
            tx,
            contactId,
            labelTemplateId
          )
        )
      );
    }
  };

  private updateContactInTransaction = async (
    tx: PgTransaction<
      NodePgQueryResultHKT,
      typeof schema,
      ExtractTablesWithRelations<typeof schema>
    >,
    contactId: string,
    input: IUpdateContact
  ): Promise<boolean> => {
    const updateInput = this.updateInput(input);

    const result = await tx
      .update(contact)
      .set(updateInput)
      .where(eq(contact.contact_id, contactId))
      .execute();

    return result.rowCount === 1;
  };

  private updateContactWithoutTransaction = async (
    contactId: string,
    input: IUpdateContact
  ): Promise<boolean> => {
    const updateInput = this.updateInput(input);

    const result = await this.dbRw
      .update(contact)
      .set(updateInput)
      .where(eq(contact.contact_id, contactId))
      .execute();

    return result.rowCount === 1;
  };

  updateContactById = async (
    contactId: string,
    input: IUpdateContact,
    accountId?: string | null
  ): Promise<boolean> => {
    const hasLabelTemplates = input.label_template_ids !== undefined;
    const hasChannelIds = input.channel_ids !== undefined;

    if (hasLabelTemplates) {
      return this.dbRw.transaction(async (tx) => {
        const labelTemplateIds = input.label_template_ids ?? [];

        await this.syncLabelTemplatesInTransaction(
          tx,
          contactId,
          labelTemplateIds
        );

        if (hasChannelIds && accountId) {
          await this.contactChannelsUpdaterTransactionRepository.updateContactChannels(
            contactId,
            accountId,
            input.channel_ids ?? []
          );
        }

        return this.updateContactInTransaction(tx, contactId, input);
      });
    }

    if (hasChannelIds && accountId) {
      await this.contactChannelsUpdaterTransactionRepository.updateContactChannels(
        contactId,
        accountId,
        input.channel_ids ?? []
      );
    }

    return this.updateContactWithoutTransaction(contactId, input);
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

    const result = await this.dbRw
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
    const result = await this.dbRw
      .update(contact)
      .set({ is_valided: isValided })
      .where(eq(contact.contact_id, contactId))
      .execute();

    return result.rowCount === 1;
  };
}
