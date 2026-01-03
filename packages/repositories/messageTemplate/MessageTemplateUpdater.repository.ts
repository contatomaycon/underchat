import * as schema from '@core/models';
import { messageTemplate } from '@core/models';
import { NodePgDatabase } from 'drizzle-orm/node-postgres';
import { inject, injectable } from 'tsyringe';
import { eq } from 'drizzle-orm';
import { IUpdateMessageTemplate } from '@core/interfaces/repositories/messageTemplate/IUpdateMessageTemplate';

@injectable()
export class MessageTemplateUpdaterRepository {
  constructor(
    @inject('DatabaseRw') private readonly dbRw: NodePgDatabase<typeof schema>
  ) {}

  private updateInput(
    input: IUpdateMessageTemplate
  ): Partial<typeof messageTemplate.$inferInsert> {
    const inputUpdate: Partial<typeof messageTemplate.$inferInsert> = {};

    if (input?.command !== undefined && input.command !== null) {
      inputUpdate.command = input.command;
    }

    if (input?.message !== undefined && input.message !== null) {
      inputUpdate.message = input.message;
    }

    if (
      input?.message_status_id !== undefined &&
      input.message_status_id !== null
    ) {
      inputUpdate.message_status_id = input.message_status_id;
    }

    if (input?.type !== undefined && input.type !== null) {
      inputUpdate.type = input.type;
    }

    if (input?.attachment_url !== undefined) {
      inputUpdate.attachment_url = input.attachment_url ?? undefined;
    }

    if (input?.mimetype !== undefined) {
      inputUpdate.mimetype = input.mimetype ?? undefined;
    }

    if (input?.duration !== undefined) {
      inputUpdate.duration = input.duration ?? undefined;
    }

    if (input?.width !== undefined) {
      inputUpdate.width = input.width ?? undefined;
    }

    if (input?.height !== undefined) {
      inputUpdate.height = input.height ?? undefined;
    }

    if (input?.auto_send !== undefined) {
      inputUpdate.auto_send = input.auto_send ?? false;
    }

    return inputUpdate;
  }

  updateMessageTemplateById = async (
    input: IUpdateMessageTemplate
  ): Promise<boolean> => {
    const updateInput = this.updateInput(input);

    const result = await this.dbRw
      .update(messageTemplate)
      .set(updateInput)
      .where(eq(messageTemplate.message_template_id, input.message_template_id))
      .execute();

    return result.rowCount === 1;
  };
}
