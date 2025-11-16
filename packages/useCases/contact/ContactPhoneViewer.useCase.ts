import { injectable } from 'tsyringe';
import { TFunction } from 'i18next';
import { ContactService } from '@core/services/contact.service';

@injectable()
export class ContactPhoneViewerUseCase {
  constructor(private readonly contactService: ContactService) {}

  async execute(
    t: TFunction<'translation', undefined>,
    contactId: string
  ): Promise<{ phone: string | null } | null> {
    const sensitiveData =
      await this.contactService.getContactSensitiveDataDecrypted(contactId);

    if (!sensitiveData) {
      throw new Error(t('contact_not_found'));
    }

    return {
      phone: sensitiveData.phone,
    };
  }
}
