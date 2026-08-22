import { injectable, inject } from 'tsyringe';
import { TFunction } from 'i18next';
import { ContactValidatorUseCase } from '@core/useCases/contact/ContactValidator.useCase';
import type { OutboundWebhookRequestSource } from '@core/common/functions/outboundWebhookRequestSource';

@injectable()
export class ChatContactValidatorUseCase {
  constructor(
    @inject(ContactValidatorUseCase)
    private readonly contactValidatorUseCase: ContactValidatorUseCase
  ) {}

  async execute(
    t: TFunction<'translation', undefined>,
    contactId: string,
    accountId: string,
    actorUserId?: string,
    webhookSource: OutboundWebhookRequestSource = 'manager_api'
  ): Promise<boolean> {
    return this.contactValidatorUseCase.execute(
      t,
      contactId,
      accountId,
      actorUserId,
      webhookSource
    );
  }
}
