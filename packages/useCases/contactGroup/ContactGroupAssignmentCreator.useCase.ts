import { injectable } from 'tsyringe';
import { TFunction } from 'i18next';
import { CreateContactGroupAssignmentRequest } from '@core/schema/contactGroup/createContactGroupAssignment/request.schema';
import { CsvFileReaderService } from '@core/services/csv.service';
import { ContactService } from '@core/services/contact.service';

@injectable()
export class ContactGroupAssignmentCreatorUseCase {
  constructor(
    private readonly csvFileReaderService: CsvFileReaderService,
    private readonly contactService: ContactService
  ) {}

  async execute(
    t: TFunction<'translation', undefined>,
    input: CreateContactGroupAssignmentRequest,
    accountId: string
  ): Promise<boolean> {
    if (!input.contacts) return true;
    const contacts = await this.csvFileReaderService.read(input.contacts);

    if (!contacts.length) {
      throw new Error(t('no_contacts_found_in_file'));
    }

    for (const contact of contacts) {
      const contactCreated = await this.contactService.createContactTx(
        t,
        contact,
        input?.contact_group_id?.value ?? '',
        accountId
      );

      if (!contactCreated) {
        throw new Error(t('contact_creation_failed'));
      }
    }

    return true;
  }
}
