import * as schema from '@core/models';
import { contactLabelTemplate } from '@core/models';
import { NodePgQueryResultHKT } from 'drizzle-orm/node-postgres';
import { injectable } from 'tsyringe';
import { eq, ExtractTablesWithRelations } from 'drizzle-orm';
import { PgTransaction } from 'drizzle-orm/pg-core';

@injectable()
export class ContactLabelTemplateDeleterRepository {
  constructor() {}

  deleteContactLabelTemplatesByContactId = async (
    tx: PgTransaction<
      NodePgQueryResultHKT,
      typeof schema,
      ExtractTablesWithRelations<typeof schema>
    >,
    contactId: string
  ): Promise<boolean> => {
    const result = await tx
      .delete(contactLabelTemplate)
      .where(eq(contactLabelTemplate.contact_id, contactId))
      .execute();

    return (result.rowCount ?? 0) > 0;
  };
}
