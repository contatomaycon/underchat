import * as schema from '@core/models';
import { labelTemplate } from '@core/models';
import { CreateLabelTemplateRequest } from '@core/schema/labelTemplate/createLabelTemplate/request.schema';
import { NodePgDatabase } from 'drizzle-orm/node-postgres';
import { inject, injectable } from 'tsyringe';
import { v7 as uuidv7 } from 'uuid';

@injectable()
export class LabelTemplateCreatorRepository {
  constructor(
    @inject('DatabaseRw') private readonly dbRw: NodePgDatabase<typeof schema>
  ) {}

  createLabelTemplate = async (
    input: CreateLabelTemplateRequest,
    accountId: string
  ): Promise<string | null> => {
    const labelTemplateId = uuidv7();

    const result = await this.dbRw
      .insert(labelTemplate)
      .values({
        label_template_id: labelTemplateId,
        account_id: accountId,
        label_status_id: input.label_status.label_status_id,
        label: input.label,
        color: input.color,
      })
      .execute();

    if (!result) {
      return null;
    }

    return labelTemplateId;
  };
}
