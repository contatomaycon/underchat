import { injectable } from 'tsyringe';
import { TFunction } from 'i18next';
import { ContactService } from '@core/services/contact.service';

@injectable()
export class ContactEmailViewerUseCase {
  constructor(private readonly contactService: ContactService) {}

  async execute(
    t: TFunction<'translation', undefined>,
    contactId: string
  ): Promise<{ email: string | null } | null> {
    const sensitiveData =
      await this.contactService.getContactSensitiveDataDecrypted(contactId);

    if (!sensitiveData) {
      throw new Error(t('contact_not_found'));
    }

    return {
      email: sensitiveData.email,
    };
  }
}

