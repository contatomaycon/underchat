import { injectable, inject } from 'tsyringe';
import { TFunction } from 'i18next';
import { ContactService } from '@core/services/contact.service';
import { ContactViewerRepository } from '@core/repositories/contact/ContactViewer.repository';
import { ContactLabelTemplateDeleterRepository } from '@core/repositories/contact/ContactLabelTemplateDeleter.repository';
import type { OutboundWebhookRequestSource } from '@core/common/functions/outboundWebhookRequestSource';

@injectable()
export class ContactLabelTemplateRemoverUseCase {
  constructor(
    @inject(ContactService)
    private readonly contactService: ContactService,
    @inject(ContactViewerRepository)
    private readonly contactViewerRepository: ContactViewerRepository,
    @inject(ContactLabelTemplateDeleterRepository)
    private readonly contactLabelTemplateDeleterRepository: ContactLabelTemplateDeleterRepository
  ) {}

  async execute(
    t: TFunction<'translation', undefined>,
    accountId: string,
    contactId: string,
    labelTemplateId: string,
    actorUserId?: string,
    webhookSource: OutboundWebhookRequestSource = 'manager_api'
  ): Promise<boolean> {
    const contact = await this.contactViewerRepository.viewContactById(
      contactId,
      accountId
    );

    if (!contact) {
      throw new Error(t('contact_not_found'));
    }

    const contactLabelTemplateId =
      await this.contactLabelTemplateDeleterRepository.findContactLabelTemplateId(
        contactId,
        labelTemplateId,
        accountId
      );
    if (!contactLabelTemplateId) {
      // DELETE is idempotent. This also makes a retry safe when the first
      // request committed the transactional outbox marker but the connection
      // closed before the success response reached the caller.
      return true;
    }

    const result = await this.contactService.removeContactLabelTemplate(
      contactId,
      labelTemplateId,
      accountId,
      {
        source: webhookSource,
        idempotencyKey: `contact-label-removed:${contactId}:${labelTemplateId}:${contactLabelTemplateId}`,
        actor: actorUserId
          ? { type: 'user', id: actorUserId }
          : { type: 'system' },
        changes: { removed_label_template_id: labelTemplateId },
      }
    );

    if (!result) {
      throw new Error(t('contact_label_template_remove_error'));
    }

    return true;
  }
}
