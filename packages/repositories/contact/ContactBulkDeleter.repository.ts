import * as schema from '@core/models';
import { contact } from '@core/models';
import {
  NodePgDatabase,
  NodePgQueryResultHKT,
} from 'drizzle-orm/node-postgres';
import { inject, injectable } from 'tsyringe';
import { inArray, ExtractTablesWithRelations } from 'drizzle-orm';
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
    contactIds: string[]
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
      .where(inArray(contact.contact_id, contactIds))
      .execute();

    return result.rowCount ?? 0;
  };

  deleteContactsByIds = async (contactIds: string[]): Promise<number> => {
    if (contactIds.length === 0) {
      return 0;
    }

    return this.dbRw.transaction(async (tx) => {
      await Promise.all(
        contactIds.map((contactId) =>
          this.contactLabelTemplateDeleterRepository.deleteContactLabelTemplatesByContactId(
            tx,
            contactId
          )
        )
      );

      return this.deleteContactsInTransaction(tx, contactIds);
    });
  };
}
