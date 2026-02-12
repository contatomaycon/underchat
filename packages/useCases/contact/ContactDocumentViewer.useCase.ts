import { injectable, inject } from 'tsyringe';
import { TFunction } from 'i18next';
import { ContactService } from '@core/services/contact.service';
import { ViewContactDocumentResponse } from '@core/schema/contact/viewContactDocument/response.schema';

@injectable()
export class ContactDocumentViewerUseCase {
  constructor(
    @inject(ContactService)
    private readonly contactService: ContactService
  ) {}

  async execute(
    t: TFunction<'translation', undefined>,
    contactId: string
  ): Promise<ViewContactDocumentResponse | null> {
    const sensitiveData =
      await this.contactService.getContactSensitiveDataDecrypted(contactId);

    if (!sensitiveData) {
      throw new Error(t('contact_not_found'));
    }

    return {
      document: sensitiveData.document,
    };
  }
}
