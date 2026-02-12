import { injectable, inject } from 'tsyringe';
import { TFunction } from 'i18next';
import { ViewMessageTemplateResponse } from '@core/schema/messageTemplate/viewMessageTemplate/response.schema';
import { MessageTemplateService } from '@core/services/messageTemplate.service';

@injectable()
export class MessageTemplateViewerUseCase {
  constructor(
    @inject(MessageTemplateService)
    private readonly messageTemplateService: MessageTemplateService
  ) {}

  async execute(
    t: TFunction<'translation', undefined>,
    messageTemplateId: string
  ): Promise<ViewMessageTemplateResponse | null> {
    const messageTemplateExists =
      await this.messageTemplateService.existsMessageTemplateById(
        messageTemplateId
      );

    if (!messageTemplateExists) {
      throw new Error(t('message_template_not_found'));
    }

    return this.messageTemplateService.viewMessageTemplateById(
      messageTemplateId
    );
  }
}
