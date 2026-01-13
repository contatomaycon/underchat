import * as schema from '@core/models';
import { contactLabelTemplate } from '@core/models';
import { ExtractTablesWithRelations } from 'drizzle-orm';
import {
  NodePgDatabase,
  NodePgQueryResultHKT,
} from 'drizzle-orm/node-postgres';
import { PgTransaction } from 'drizzle-orm/pg-core';
import { inject, injectable } from 'tsyringe';
import { v7 as uuidv7 } from 'uuid';

@injectable()
export class ContactLabelTemplateCreatorRepository {
  constructor(
    @inject('DatabaseRw') private readonly dbRw: NodePgDatabase<typeof schema>
  ) {}

  createContactLabelTemplate = async (
    tx: PgTransaction<
      NodePgQueryResultHKT,
      typeof schema,
      ExtractTablesWithRelations<typeof schema>
    >,
    contactId: string,
    labelTemplateId: string
  ): Promise<string | null> => {
    const contactLabelTemplateId = uuidv7();

    const result = await tx
      .insert(contactLabelTemplate)
      .values({
        contact_label_template_id: contactLabelTemplateId,
        contact_id: contactId,
        label_template_id: labelTemplateId,
      })
      .execute();

    if (!result) {
      return null;
    }

    return contactLabelTemplateId;
  };

  createContactLabelTemplateWithoutTransaction = async (
    contactId: string,
    labelTemplateId: string
  ): Promise<string | null> => {
    const contactLabelTemplateId = uuidv7();

    const result = await this.dbRw
      .insert(contactLabelTemplate)
      .values({
        contact_label_template_id: contactLabelTemplateId,
        contact_id: contactId,
        label_template_id: labelTemplateId,
      })
      .execute();

    if (!result) {
      return null;
    }

    return contactLabelTemplateId;
  };
}
