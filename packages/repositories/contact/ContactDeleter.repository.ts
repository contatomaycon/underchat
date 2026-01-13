import * as schema from '@core/models';
import { contact } from '@core/models';
import {
  NodePgDatabase,
  NodePgQueryResultHKT,
} from 'drizzle-orm/node-postgres';
import { inject, injectable } from 'tsyringe';
import { eq, ExtractTablesWithRelations } from 'drizzle-orm';
import { PgTransaction } from 'drizzle-orm/pg-core';
import { currentTime } from '@core/common/functions/currentTime';
import { ContactLabelTemplateDeleterRepository } from './ContactLabelTemplateDeleter.repository';

@injectable()
export class ContactDeleterRepository {
  constructor(
    @inject('DatabaseRw') private readonly dbRw: NodePgDatabase<typeof schema>,
    private readonly contactLabelTemplateDeleterRepository: ContactLabelTemplateDeleterRepository
  ) {}

  private deleteContactInTransaction = async (
    tx: PgTransaction<
      NodePgQueryResultHKT,
      typeof schema,
      ExtractTablesWithRelations<typeof schema>
    >,
    contactId: string
  ): Promise<boolean> => {
    const date = currentTime();

    const result = await tx
      .update(contact)
      .set({
        deleted_at: date,
      })
      .where(eq(contact.contact_id, contactId))
      .execute();

    return result.rowCount === 1;
  };

  deleteContactById = async (contactId: string): Promise<boolean> => {
    return this.dbRw.transaction(async (tx) => {
      await this.contactLabelTemplateDeleterRepository.deleteContactLabelTemplatesByContactId(
        tx,
        contactId
      );

      return this.deleteContactInTransaction(tx, contactId);
    });
  };
}
