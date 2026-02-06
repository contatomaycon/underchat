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
import { truncateContactName } from '@core/common/functions/truncateContactName';
import { ContactGroupAssignmentCreatorRepository } from '../contactGroup/ContactGroupAssignmentCreator.repository';
import { ContactLabelTemplateCreatorRepository } from './ContactLabelTemplateCreator.repository';
import { ContactChannelCreatorRepository } from './ContactChannelCreator.repository';
import { TFunction } from 'i18next';
import { EContactIgnore } from '@core/common/enums/EContactIgnore';

@injectable()
export class ContactCreatorRepository {
  constructor(
    @inject('DatabaseRw') private readonly dbRw: NodePgDatabase<typeof schema>,
    private readonly contactGroupAssignmentCreatorRepository: ContactGroupAssignmentCreatorRepository,
    private readonly contactLabelTemplateCreatorRepository: ContactLabelTemplateCreatorRepository,
    private readonly contactChannelCreatorRepository: ContactChannelCreatorRepository
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
      name: truncateContactName(input.name) ?? '',
      last_name: truncateContactName(input.last_name),
      email: this.truncateField(input.email, 500),
      email_partial: this.truncateField(input.email_partial, 50),
      email_c: this.truncateField(input.email_c, 500),
      phone_ddi: this.truncateField(input.phone_ddi, 5),
      phone: this.truncateField(input.phone, 500),
      phone_partial: this.truncateField(input.phone_partial, 15),
      phone_c: this.truncateField(input.phone_c, 500),
      nickname: truncateContactName(input.nickname),
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
    const hasLabels = this.hasLabelTemplates(validatedInput);
    const hasChannels = this.hasChannels(validatedInput);
    const needsTransaction = (hasLabels || hasChannels) && !tx;

    if (needsTransaction) {
      return this.createContactWithLabelsAndChannels(validatedInput, contactId);
    }

    return this.executeCreateContact(
      validatedInput,
      contactId,
      tx || this.dbRw,
      tx ? hasLabels : false,
      tx ? hasChannels : false
    );
  };

  private readonly hasLabelTemplates = (
    validatedInput: ICreateContact
  ): boolean => {
    return (
      !!validatedInput.label_template_ids &&
      validatedInput.label_template_ids.length > 0
    );
  };

  private readonly hasChannels = (validatedInput: ICreateContact): boolean => {
    return (
      !!validatedInput.channel_ids && validatedInput.channel_ids.length > 0
    );
  };

  private readonly createContactWithLabelsAndChannels = async (
    validatedInput: ICreateContact,
    contactId: string
  ): Promise<string | null> => {
    return this.dbRw.transaction(async (transaction) => {
      const insertResult = await this.insertContact(
        transaction,
        contactId,
        validatedInput
      );

      if (!insertResult) {
        return null;
      }

      await this.createLabelTemplates(
        transaction,
        contactId,
        validatedInput.label_template_ids ?? []
      );

      await this.createContactChannels(
        transaction,
        contactId,
        validatedInput.channel_ids ?? [],
        validatedInput.account_id ?? null
      );

      return contactId;
    });
  };

  private readonly executeCreateContact = async (
    validatedInput: ICreateContact,
    contactId: string,
    dbOrTx:
      | NodePgDatabase<typeof schema>
      | PgTransaction<
          NodePgQueryResultHKT,
          typeof schema,
          ExtractTablesWithRelations<typeof schema>
        >,
    createLabels: boolean,
    createChannels: boolean
  ): Promise<string | null> => {
    try {
      const insertResult = await this.insertContact(
        dbOrTx,
        contactId,
        validatedInput
      );

      if (!insertResult) {
        return null;
      }

      const tx = dbOrTx as PgTransaction<
        NodePgQueryResultHKT,
        typeof schema,
        ExtractTablesWithRelations<typeof schema>
      >;

      if (createLabels) {
        await this.createLabelTemplates(
          tx,
          contactId,
          validatedInput.label_template_ids ?? []
        );
      }

      if (createChannels) {
        await this.createContactChannels(
          tx,
          contactId,
          validatedInput.channel_ids ?? [],
          validatedInput.account_id ?? null
        );
      }

      return contactId;
    } catch (error) {
      return this.handleInsertError(error);
    }
  };

  private readonly insertContact = async (
    dbOrTx:
      | NodePgDatabase<typeof schema>
      | PgTransaction<
          NodePgQueryResultHKT,
          typeof schema,
          ExtractTablesWithRelations<typeof schema>
        >,
    contactId: string,
    validatedInput: ICreateContact
  ) => {
    const contactValues = this.buildContactValues(contactId, validatedInput);

    return dbOrTx.insert(contact).values(contactValues).execute();
  };

  private readonly buildContactValues = (
    contactId: string,
    validatedInput: ICreateContact
  ) => {
    return {
      contact_id: contactId,
      account_id: validatedInput.account_id,
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
    };
  };

  private readonly createLabelTemplates = async (
    tx: PgTransaction<
      NodePgQueryResultHKT,
      typeof schema,
      ExtractTablesWithRelations<typeof schema>
    >,
    contactId: string,
    labelTemplateIds: string[]
  ) => {
    const validLabelTemplateIds = labelTemplateIds.filter(
      (labelTemplateId) => labelTemplateId
    );

    await Promise.all(
      validLabelTemplateIds.map((labelTemplateId) =>
        this.contactLabelTemplateCreatorRepository.createContactLabelTemplate(
          tx,
          contactId,
          labelTemplateId
        )
      )
    );
  };

  private readonly createContactChannels = async (
    tx: PgTransaction<
      NodePgQueryResultHKT,
      typeof schema,
      ExtractTablesWithRelations<typeof schema>
    >,
    contactId: string,
    channelIds: string[],
    accountId: string | null
  ) => {
    if (!accountId || channelIds.length === 0) {
      return;
    }

    const validChannelIds = channelIds.filter((channelId) => channelId);

    await Promise.all(
      validChannelIds.map((channelId) =>
        this.contactChannelCreatorRepository.createContactChannelInTransaction(
          tx,
          contactId,
          channelId,
          accountId
        )
      )
    );
  };

  private readonly handleInsertError = (error: unknown): null => {
    const pgError = error as { code?: string; message?: string };
    if (pgError.code === '22001') {
      return null;
    }
    throw error;
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
