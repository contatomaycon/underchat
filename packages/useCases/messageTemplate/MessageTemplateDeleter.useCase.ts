import { injectable } from 'tsyringe';
import { TFunction } from 'i18next';
import { MessageTemplateService } from '@core/services/messageTemplate.service';

@injectable()
export class MessageTemplateDeleterUseCase {
  constructor(
    private readonly messageTemplateService: MessageTemplateService
  ) {}

  async execute(
    t: TFunction<'translation', undefined>,
    messageTemplateId: string
  ): Promise<boolean> {
    const messageTemplateExists =
      await this.messageTemplateService.existsMessageTemplateById(
        messageTemplateId
      );

    if (!messageTemplateExists) {
      throw new Error(t('message_template_not_found'));
    }

    return this.messageTemplateService.deleteMessageTemplateById(
      messageTemplateId
    );
  }
}
