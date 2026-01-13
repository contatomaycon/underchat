import { injectable } from 'tsyringe';
import { TFunction } from 'i18next';
import { ContactService } from '@core/services/contact.service';
import { ContactViewerRepository } from '@core/repositories/contact/ContactViewer.repository';

@injectable()
export class ContactLabelTemplateRemoverUseCase {
  constructor(
    private readonly contactService: ContactService,
    private readonly contactViewerRepository: ContactViewerRepository
  ) {}

  async execute(
    t: TFunction<'translation', undefined>,
    accountId: string,
    contactId: string,
    labelTemplateId: string
  ): Promise<boolean> {
    const contact = await this.contactViewerRepository.viewContactById(
      contactId,
      accountId
    );

    if (!contact) {
      throw new Error(t('contact_not_found'));
    }

    const result = await this.contactService.removeContactLabelTemplate(
      contactId,
      labelTemplateId
    );

    if (!result) {
      throw new Error(t('contact_label_template_remove_error'));
    }

    return true;
  }
}
