import * as schema from '@core/models';
import { contact } from '@core/models';
import {
  NodePgDatabase,
  NodePgQueryResultHKT,
} from 'drizzle-orm/node-postgres';
import { inject, injectable } from 'tsyringe';
import {
  and,
  eq,
  inArray,
  isNull,
  ExtractTablesWithRelations,
} from 'drizzle-orm';
import { PgTransaction } from 'drizzle-orm/pg-core';
import { currentTime } from '@core/common/functions/currentTime';
import { ContactLabelTemplateDeleterRepository } from './ContactLabelTemplateDeleter.repository';

@injectable()
export class ContactBulkDeleterRepository {
  constructor(
    @inject('DatabaseRw') private readonly dbRw: NodePgDatabase<typeof schema>,
    @inject(ContactLabelTemplateDeleterRepository)
    private readonly contactLabelTemplateDeleterRepository: ContactLabelTemplateDeleterRepository
  ) {}

  private deleteContactsInTransaction = async (
    tx: PgTransaction<
      NodePgQueryResultHKT,
      typeof schema,
      ExtractTablesWithRelations<typeof schema>
    >,
    contactIds: string[],
    accountId: string
  ): Promise<number> => {
    if (contactIds.length === 0) {
      return 0;
    }

    const date = currentTime();

    const result = await tx
      .update(contact)
      .set({
        deleted_at: date,
      })
      .where(
        and(
          inArray(contact.contact_id, contactIds),
          eq(contact.account_id, accountId),
          isNull(contact.deleted_at)
        )
      )
      .execute();

    return result.rowCount ?? 0;
  };

  deleteContactsByIds = async (
    contactIds: string[],
    accountId: string
  ): Promise<number> => {
    if (contactIds.length === 0) {
      return 0;
    }

    return this.dbRw.transaction(async (tx) => {
      const authorizedContacts = await tx
        .select({ contact_id: contact.contact_id })
        .from(contact)
        .where(
          and(
            inArray(contact.contact_id, contactIds),
            eq(contact.account_id, accountId),
            isNull(contact.deleted_at)
          )
        )
        .execute();
      const authorizedIds = authorizedContacts.map((row) => row.contact_id);

      await Promise.all(
        authorizedIds.map((contactId) =>
          this.contactLabelTemplateDeleterRepository.deleteContactLabelTemplatesByContactId(
            tx,
            contactId
          )
        )
      );

      return this.deleteContactsInTransaction(tx, authorizedIds, accountId);
    });
  };
}
