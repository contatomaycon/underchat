import { injectable, inject } from 'tsyringe';
import { TFunction } from 'i18next';
import { ContactService } from '@core/services/contact.service';
import { ContactUpdaterRepository } from '@core/repositories/contact/ContactUpdater.repository';
import type { OutboundWebhookRequestSource } from '@core/common/functions/outboundWebhookRequestSource';

@injectable()
export class ContactPhotoDeleterUseCase {
  constructor(
    @inject(ContactService)
    private readonly contactService: ContactService,
    @inject(ContactUpdaterRepository)
    private readonly contactUpdaterRepository: ContactUpdaterRepository
  ) {}

  async execute(
    t: TFunction<'translation', undefined>,
    contactId: string,
    accountId: string,
    actorUserId?: string,
    webhookSource: OutboundWebhookRequestSource = 'manager_api'
  ): Promise<boolean> {
    const previousContact = await this.contactService.getContactById(
      contactId,
      accountId
    );
    if (!previousContact) {
      throw new Error(t('contact_not_found'));
    }
    const mutationRevision =
      await this.contactUpdaterRepository.viewContactMutationRevision(
        contactId,
        accountId
      );
    if (!mutationRevision) {
      throw new Error(t('contact_not_found'));
    }
    if (!mutationRevision.photo) return true;

    const result = await this.contactService.deleteContactPhoto(
      contactId,
      accountId,
      {
        source: webhookSource,
        idempotencyKey: `contact-photo-deleted:${contactId}:${mutationRevision.revision}:${mutationRevision.photo}`,
        actor: actorUserId
          ? { type: 'user', id: actorUserId }
          : { type: 'system' },
        changes: { photo: null },
      }
    );

    if (!result) {
      throw new Error(t('contact_photo_delete_error'));
    }

    return true;
  }
}
