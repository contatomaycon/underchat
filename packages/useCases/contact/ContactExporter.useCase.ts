import { injectable } from 'tsyringe';
import { TFunction } from 'i18next';
import { ContactExporterRepository } from '@core/repositories/contact/ContactExporter.repository';
import { ExportContactResponse } from '@core/schema/contact/exportContact/response.schema';
import { ContactService } from '@core/services/contact.service';

@injectable()
export class ContactExporterUseCase {
  constructor(
    private readonly contactExporterRepository: ContactExporterRepository,
    private readonly contactService: ContactService
  ) {}

  async execute(
    t: TFunction<'translation', undefined>,
    accountId: string
  ): Promise<ExportContactResponse[]> {
    const contacts =
      await this.contactExporterRepository.exportContacts(accountId);

    return contacts.map((contact) => ({
      ...contact,
      email: this.contactService.getContactEmailDecrypted(contact.email),
      phone: this.contactService.getContactPhoneDecrypted(contact.phone),
    }));
  }
}
