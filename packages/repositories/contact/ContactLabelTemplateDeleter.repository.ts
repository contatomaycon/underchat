import * as schema from '@core/models';
import { contactLabelTemplate } from '@core/models';
import {
  NodePgDatabase,
  NodePgQueryResultHKT,
} from 'drizzle-orm/node-postgres';
import { inject, injectable } from 'tsyringe';
import { and, eq, ExtractTablesWithRelations } from 'drizzle-orm';
import { PgTransaction } from 'drizzle-orm/pg-core';

@injectable()
export class ContactLabelTemplateDeleterRepository {
  constructor(
    @inject('DatabaseRw') private readonly dbRw: NodePgDatabase<typeof schema>
  ) {}

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

  deleteContactLabelTemplateByContactIdAndLabelTemplateId = async (
    contactId: string,
    labelTemplateId: string
  ): Promise<boolean> => {
    const result = await this.dbRw
      .delete(contactLabelTemplate)
      .where(
        and(
          eq(contactLabelTemplate.contact_id, contactId),
          eq(contactLabelTemplate.label_template_id, labelTemplateId)
        )
      )
      .execute();

    return (result.rowCount ?? 0) > 0;
  };
}
