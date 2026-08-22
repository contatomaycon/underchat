import { injectable, inject } from 'tsyringe';
import { TFunction } from 'i18next';
import { ContactPhotoDeleterUseCase } from '@core/useCases/contact/ContactPhotoDeleter.useCase';
import type { OutboundWebhookRequestSource } from '@core/common/functions/outboundWebhookRequestSource';

@injectable()
export class ChatContactPhotoDeleterUseCase {
  constructor(
    @inject(ContactPhotoDeleterUseCase)
    private readonly contactPhotoDeleterUseCase: ContactPhotoDeleterUseCase
  ) {}

  async execute(
    t: TFunction<'translation', undefined>,
    contactId: string,
    accountId: string,
    actorUserId?: string,
    webhookSource: OutboundWebhookRequestSource = 'manager_api'
  ): Promise<boolean> {
    return this.contactPhotoDeleterUseCase.execute(
      t,
      contactId,
      accountId,
      actorUserId,
      webhookSource
    );
  }
}
