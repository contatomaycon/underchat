import { injectable } from 'tsyringe';
import { TFunction } from 'i18next';
import { ContactService } from '@core/services/contact.service';

@injectable()
export class ContactPhotoDeleterUseCase {
  constructor(private readonly contactService: ContactService) {}

  async execute(
    t: TFunction<'translation', undefined>,
    contactId: string,
    accountId: string
  ): Promise<boolean> {
    const contactExists =
      await this.contactService.existsContactById(contactId);

    if (!contactExists) {
      throw new Error(t('contact_not_found'));
    }

    const result = await this.contactService.deleteContactPhoto(
      contactId,
      accountId
    );

    if (!result) {
      throw new Error(t('contact_photo_delete_error'));
    }

    return true;
  }
}
