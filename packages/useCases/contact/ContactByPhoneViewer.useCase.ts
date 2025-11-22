import { injectable } from 'tsyringe';
import { TFunction } from 'i18next';
import { ContactService } from '@core/services/contact.service';
import { ViewContactResponse } from '@core/schema/contact/viewContact/response.schema';

@injectable()
export class ContactByPhoneViewerUseCase {
  constructor(private readonly contactService: ContactService) {}

  async execute(
    t: TFunction<'translation', undefined>,
    accountId: string,
    phone: string,
    phoneDdi: string | null
  ): Promise<ViewContactResponse | null> {
    if (!phone) {
      return null;
    }

    return this.contactService.getContactByPhone(accountId, phone, phoneDdi);
  }
}
