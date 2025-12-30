import * as schema from '@core/models';
import { labelTemplate } from '@core/models';
import { NodePgDatabase } from 'drizzle-orm/node-postgres';
import { inject, injectable } from 'tsyringe';
import { eq } from 'drizzle-orm';
import { UpdateLabelTemplateRequest } from '@core/schema/labelTemplate/editLabelTemplate/request.schema';

@injectable()
export class LabelTemplateUpdaterRepository {
  constructor(
    @inject('DatabaseRw') private readonly dbRw: NodePgDatabase<typeof schema>
  ) {}

  private updateInput(
    input: UpdateLabelTemplateRequest
  ): Partial<typeof labelTemplate.$inferInsert> {
    const inputUpdate: Partial<typeof labelTemplate.$inferInsert> = {};

    if (input?.label) {
      inputUpdate.label = input.label;
    }

    if (input?.color) {
      inputUpdate.color = input.color;
    }

    if (input.label_status?.label_status_id) {
      inputUpdate.label_status_id = input.label_status.label_status_id;
    }

    return inputUpdate;
  }

  updateLabelTemplateById = async (
    labelTemplateId: string,
    input: UpdateLabelTemplateRequest
  ): Promise<boolean> => {
    const updateInput = this.updateInput(input);

    const result = await this.dbRw
      .update(labelTemplate)
      .set(updateInput)
      .where(eq(labelTemplate.label_template_id, labelTemplateId))
      .execute();

    return result.rowCount === 1;
  };
}
