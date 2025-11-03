import { injectable } from 'tsyringe';
import { TFunction } from 'i18next';
import { AccountService } from '@core/services/account.service';
import { CreateMessageTemplateRequest } from '@core/schema/messageTemplate/createMessageTemplate/request.schema';
import { MessageTemplateService } from '@core/services/messageTemplate.service';

@injectable()
export class MessageTemplateCreatorUseCase {
  constructor(
    private readonly messageTemplateService: MessageTemplateService,
    private readonly accountService: AccountService
  ) {}

  async execute(
    t: TFunction<'translation', undefined>,
    input: CreateMessageTemplateRequest,
    accountId: string
  ): Promise<boolean> {
    const accountExists =
      await this.accountService.existsAccountById(accountId);

    if (!accountExists) {
      throw new Error(t('account_not_found'));
    }

    const messageStatusExists =
      await this.messageTemplateService.existsMessageStatusById(
        input.message_status.message_status_id
      );

    if (!messageStatusExists) {
      throw new Error(t('message_status_not_found'));
    }

    const createMessageTemplate =
      await this.messageTemplateService.createMessageTemplate(input, accountId);

    if (!createMessageTemplate) {
      throw new Error(t('message_template_creation_failed'));
    }

    return true;
  }
}
