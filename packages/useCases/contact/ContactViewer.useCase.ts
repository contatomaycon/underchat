import { injectable } from 'tsyringe';
import { TFunction } from 'i18next';
import { ContactService } from '@core/services/contact.service';
import { ViewContactResponse } from '@core/schema/contact/viewContact/response.schema';

@injectable()
export class ContactViewerUseCase {
  constructor(private readonly contactService: ContactService) {}

  async execute(
    t: TFunction<'translation', undefined>,
    contactId: string
  ): Promise<ViewContactResponse | null> {
    const contactExists =
      await this.contactService.existsContactById(contactId);

    if (!contactExists) {
      throw new Error(t('contact_not_found'));
    }

    return this.contactService.viewContactById(contactId);
  }
}
