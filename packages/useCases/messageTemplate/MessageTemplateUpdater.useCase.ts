import { injectable } from 'tsyringe';
import { TFunction } from 'i18next';
import { MessageTemplateService } from '@core/services/messageTemplate.service';
import { UpdateMessageTemplateRequest } from '@core/schema/messageTemplate/editMessageTemplate/request.schema';

@injectable()
export class MessageTemplateUpdaterUseCase {
  constructor(
    private readonly messageTemplateService: MessageTemplateService
  ) {}

  async execute(
    t: TFunction<'translation', undefined>,
    messageTemplateId: string,
    body: UpdateMessageTemplateRequest
  ): Promise<boolean> {
    const messageTemplateExists =
      await this.messageTemplateService.existsMessageTemplateById(
        messageTemplateId
      );

    if (!messageTemplateExists) {
      throw new Error(t('message_template_not_found'));
    }

    const messageTemplateUpdater =
      await this.messageTemplateService.updateMessageTemplateById(
        messageTemplateId,
        body
      );

    if (!messageTemplateUpdater) {
      throw new Error(t('message_template_update_error'));
    }

    return messageTemplateUpdater;
  }
}
