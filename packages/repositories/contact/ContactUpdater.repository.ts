import * as schema from '@core/models';
import { contact } from '@core/models';
import {
  NodePgDatabase,
  NodePgQueryResultHKT,
} from 'drizzle-orm/node-postgres';
import { inject, injectable } from 'tsyringe';
import { and, eq, ExtractTablesWithRelations, isNull, sql } from 'drizzle-orm';
import { PgTransaction } from 'drizzle-orm/pg-core';
import { IUpdateContact } from '@core/common/interfaces/IUpdateContact';
import { nullIfEmpty } from '@core/common/functions/nullIfEmpty';
import { EContactIgnore } from '@core/common/enums/EContactIgnore';
import { ContactLabelTemplateDeleterRepository } from './ContactLabelTemplateDeleter.repository';
import { ContactLabelTemplateCreatorRepository } from './ContactLabelTemplateCreator.repository';
import { ContactChannelsUpdaterTransactionRepository } from './ContactChannelsUpdaterTransaction.repository';
import {
  type ContactOutboundWebhookMarker,
  lockContactOutboundWebhookSnapshotInTransaction,
  markContactOutboundWebhookAppliedInTransaction,
  viewContactOutboundWebhookSnapshotWithExecutor,
} from './contactOutboundWebhookOutbox';
import {
  assertCurrentWhatsappRuntimeInTransaction,
  StaleWhatsappRuntimeDatabaseFenceError,
  type WhatsappRuntimeDatabaseFence,
} from '@core/repositories/worker/WhatsappRuntimeDatabaseFence.repository';
import type { ContactValidationOrigin } from '@core/common/types/ContactValidationOrigin';

@injectable()
export class ContactUpdaterRepository {
  constructor(
    @inject('DatabaseRw') private readonly dbRw: NodePgDatabase<typeof schema>,
    @inject(ContactLabelTemplateDeleterRepository)
    private readonly contactLabelTemplateDeleterRepository: ContactLabelTemplateDeleterRepository,
    @inject(ContactLabelTemplateCreatorRepository)
    private readonly contactLabelTemplateCreatorRepository: ContactLabelTemplateCreatorRepository,
    @inject(ContactChannelsUpdaterTransactionRepository)
    private readonly contactChannelsUpdaterTransactionRepository: ContactChannelsUpdaterTransactionRepository
  ) {}

  /**
   * Returns the PostgreSQL row revision used to identify a logical contact
   * mutation without exposing infrastructure metadata through public contact
   * schemas. `xmin` changes on every row update, so concurrent readers share
   * a revision while a later delete/re-upload cycle receives a new one.
   */
  viewContactMutationRevision = async (
    contactId: string,
    accountId: string
  ): Promise<{ revision: string; photo: string | null } | null> => {
    const result = await this.dbRw
      .select({
        revision: sql<string>`xmin::text`,
        photo: contact.photo,
      })
      .from(contact)
      .where(
        and(
          eq(contact.contact_id, contactId),
          eq(contact.account_id, accountId)
        )
      )
      .limit(1)
      .execute();

    return result[0] ?? null;
  };

  /**
   * Reads the canonical outbound-webhook projection from the writer database.
   * The projection deliberately selects only masked/public contact columns;
   * encrypted-at-rest `email`, `phone` and `document` never leave this layer.
   */
  viewContactOutboundWebhookSnapshot = async (
    contactId: string,
    accountId?: string
  ): Promise<Record<string, unknown> | null> => {
    return viewContactOutboundWebhookSnapshotWithExecutor(
      this.dbRw,
      contactId,
      accountId
    );
  };

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

    if (input.nickname !== undefined) {
      inputUpdate.nickname = nullIfEmpty(input.nickname);
    }

    if (input.birthday !== undefined) {
      inputUpdate.birthday = nullIfEmpty(input.birthday);
    }

    if (input.notes !== undefined) {
      inputUpdate.notes = nullIfEmpty(input.notes);
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
    if (!inputUpdate.is_valided) {
      inputUpdate.validation_origin = null;
    } else if (input.validation_origin !== undefined) {
      inputUpdate.validation_origin = input.validation_origin;
    }

    return inputUpdate;
  }

  private syncLabelTemplatesInTransaction = async (
    tx: PgTransaction<
      NodePgQueryResultHKT,
      typeof schema,
      ExtractTablesWithRelations<typeof schema>
    >,
    contactId: string,
    labelTemplateIds: string[],
    accountId: string
  ): Promise<void> => {
    await this.contactLabelTemplateDeleterRepository.deleteContactLabelTemplatesByContactId(
      tx,
      contactId
    );

    const uniqueLabelTemplateIds = [...new Set(labelTemplateIds)];
    if (uniqueLabelTemplateIds.length > 0) {
      for (const labelTemplateId of uniqueLabelTemplateIds) {
        const assignmentId =
          await this.contactLabelTemplateCreatorRepository.createContactLabelTemplate(
            tx,
            contactId,
            labelTemplateId,
            accountId
          );
        if (!assignmentId) {
          throw new Error('contact_label_template_creation_failed');
        }
      }
    }
  };

  private updateContactInTransaction = async (
    tx: PgTransaction<
      NodePgQueryResultHKT,
      typeof schema,
      ExtractTablesWithRelations<typeof schema>
    >,
    contactId: string,
    input: IUpdateContact,
    accountId?: string | null
  ): Promise<boolean> => {
    const updateInput = this.updateInput(input);

    const result = await tx
      .update(contact)
      .set(updateInput)
      .where(
        and(
          eq(contact.contact_id, contactId),
          isNull(contact.deleted_at),
          accountId ? eq(contact.account_id, accountId) : undefined
        )
      )
      .execute();

    return result.rowCount === 1;
  };

  private updateContactWithoutTransaction = async (
    contactId: string,
    input: IUpdateContact,
    accountId?: string | null
  ): Promise<boolean> => {
    const updateInput = this.updateInput(input);

    const result = await this.dbRw
      .update(contact)
      .set(updateInput)
      .where(
        and(
          eq(contact.contact_id, contactId),
          isNull(contact.deleted_at),
          accountId ? eq(contact.account_id, accountId) : undefined
        )
      )
      .execute();

    return result.rowCount === 1;
  };

  updateContactById = async (
    contactId: string,
    input: IUpdateContact,
    accountId?: string | null,
    webhookMarker?: ContactOutboundWebhookMarker | null,
    runtimeFence?: WhatsappRuntimeDatabaseFence | null
  ): Promise<boolean> => {
    const hasLabelTemplates = input.label_template_ids !== undefined;
    const hasChannelIds = input.channel_ids !== undefined;
    const scopedAccountId =
      runtimeFence?.account_id.trim() || accountId?.trim() || undefined;
    if (hasLabelTemplates && !scopedAccountId) {
      throw new Error('contact_label_template_account_required');
    }

    if (
      runtimeFence &&
      accountId &&
      accountId.trim() !== runtimeFence.account_id.trim()
    ) {
      throw new StaleWhatsappRuntimeDatabaseFenceError();
    }

    if (hasLabelTemplates || hasChannelIds || webhookMarker || runtimeFence) {
      return this.dbRw.transaction(async (tx) => {
        if (runtimeFence) {
          await assertCurrentWhatsappRuntimeInTransaction(tx, runtimeFence);
        }
        const previousContact =
          await lockContactOutboundWebhookSnapshotInTransaction(
            tx,
            contactId,
            webhookMarker,
            scopedAccountId
          );
        const updated = await this.updateContactInTransaction(
          tx,
          contactId,
          input,
          scopedAccountId
        );
        if (!updated) return false;

        if (hasLabelTemplates) {
          await this.syncLabelTemplatesInTransaction(
            tx,
            contactId,
            input.label_template_ids ?? [],
            scopedAccountId as string
          );
        }

        if (hasChannelIds && scopedAccountId) {
          await this.contactChannelsUpdaterTransactionRepository.updateContactChannelsInTransaction(
            tx,
            contactId,
            scopedAccountId,
            input.channel_ids ?? []
          );
        }

        await markContactOutboundWebhookAppliedInTransaction(
          tx,
          contactId,
          webhookMarker,
          previousContact
        );
        return updated;
      });
    }

    return this.updateContactWithoutTransaction(
      contactId,
      input,
      scopedAccountId
    );
  };

  validateContact = async (
    contactId: string,
    input: IUpdateContact,
    accountId?: string,
    webhookMarker?: ContactOutboundWebhookMarker | null
  ): Promise<boolean> => {
    const updateInput: Partial<typeof contact.$inferInsert> = {
      phone_ddi: input.phone_ddi ?? undefined,
      phone: input.phone ?? undefined,
      phone_partial: input.phone_partial ?? undefined,
      phone_c: input.phone_c ?? undefined,
      is_valided: true,
      validation_origin: input.validation_origin,
    };

    if (!webhookMarker) {
      const result = await this.dbRw
        .update(contact)
        .set(updateInput)
        .where(
          and(
            eq(contact.contact_id, contactId),
            isNull(contact.deleted_at),
            accountId ? eq(contact.account_id, accountId) : undefined
          )
        )
        .execute();
      return result.rowCount === 1;
    }

    return this.dbRw.transaction(async (tx) => {
      const previousContact =
        await lockContactOutboundWebhookSnapshotInTransaction(
          tx,
          contactId,
          webhookMarker,
          accountId
        );
      const result = await tx
        .update(contact)
        .set(updateInput)
        .where(
          and(
            eq(contact.contact_id, contactId),
            isNull(contact.deleted_at),
            accountId ? eq(contact.account_id, accountId) : undefined
          )
        )
        .execute();
      const updated = result.rowCount === 1;
      if (updated) {
        await markContactOutboundWebhookAppliedInTransaction(
          tx,
          contactId,
          webhookMarker,
          previousContact
        );
      }
      return updated;
    });
  };

  updateContactIsValided = async (
    contactId: string,
    isValided: boolean,
    accountId?: string,
    webhookMarker?: ContactOutboundWebhookMarker | null,
    runtimeFence?: WhatsappRuntimeDatabaseFence | null,
    validationOrigin?: ContactValidationOrigin | null
  ): Promise<boolean> => {
    const scopedAccountId =
      runtimeFence?.account_id.trim() || accountId?.trim() || undefined;
    if (
      runtimeFence &&
      accountId &&
      accountId.trim() !== runtimeFence.account_id.trim()
    ) {
      throw new StaleWhatsappRuntimeDatabaseFenceError();
    }

    const validationUpdate: Partial<typeof contact.$inferInsert> = {
      is_valided: isValided,
    };
    if (!isValided) {
      validationUpdate.validation_origin = null;
    } else if (validationOrigin !== undefined) {
      validationUpdate.validation_origin = validationOrigin;
    }

    if (!webhookMarker && !runtimeFence) {
      const result = await this.dbRw
        .update(contact)
        .set(validationUpdate)
        .where(
          and(
            eq(contact.contact_id, contactId),
            isNull(contact.deleted_at),
            scopedAccountId
              ? eq(contact.account_id, scopedAccountId)
              : undefined
          )
        )
        .execute();
      return result.rowCount === 1;
    }

    return this.dbRw.transaction(async (tx) => {
      if (runtimeFence) {
        await assertCurrentWhatsappRuntimeInTransaction(tx, runtimeFence);
      }
      const previousContact =
        await lockContactOutboundWebhookSnapshotInTransaction(
          tx,
          contactId,
          webhookMarker,
          scopedAccountId
        );
      const result = await tx
        .update(contact)
        .set(validationUpdate)
        .where(
          and(
            eq(contact.contact_id, contactId),
            isNull(contact.deleted_at),
            scopedAccountId
              ? eq(contact.account_id, scopedAccountId)
              : undefined
          )
        )
        .execute();
      const updated = result.rowCount === 1;
      if (updated) {
        await markContactOutboundWebhookAppliedInTransaction(
          tx,
          contactId,
          webhookMarker,
          previousContact
        );
      }
      return updated;
    });
  };
}
