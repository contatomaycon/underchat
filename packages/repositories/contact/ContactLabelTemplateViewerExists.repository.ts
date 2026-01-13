import * as schema from '@core/models';
import { contactLabelTemplate } from '@core/models';
import { NodePgDatabase } from 'drizzle-orm/node-postgres';
import { inject, injectable } from 'tsyringe';
import { and, count, eq } from 'drizzle-orm';

@injectable()
export class ContactLabelTemplateViewerExistsRepository {
  constructor(
    @inject('DatabaseRo') private readonly dbRo: NodePgDatabase<typeof schema>
  ) {}

  existsContactLabelTemplate = async (
    contactId: string,
    labelTemplateId: string
  ): Promise<boolean> => {
    const result = await this.dbRo
      .select({
        total: count(),
      })
      .from(contactLabelTemplate)
      .where(
        and(
          eq(contactLabelTemplate.contact_id, contactId),
          eq(contactLabelTemplate.label_template_id, labelTemplateId)
        )
      )
      .execute();

    if (!result.length) {
      return false;
    }

    return result[0].total > 0;
  };
}
