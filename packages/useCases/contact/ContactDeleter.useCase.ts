import { injectable, inject } from 'tsyringe';
import { TFunction } from 'i18next';
import { ContactService } from '@core/services/contact.service';

@injectable()
export class ContactDeleterUseCase {
  constructor(
    @inject(ContactService)
    private readonly contactService: ContactService
  ) {}

  async execute(
    t: TFunction<'translation', undefined>,
    contactId: string
  ): Promise<boolean> {
    const contactExists =
      await this.contactService.existsContactById(contactId);

    if (!contactExists) {
      throw new Error(t('contact_not_found'));
    }

    return this.contactService.deleteContactById(contactId);
  }
}
