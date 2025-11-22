import { injectable } from 'tsyringe';
import { TFunction } from 'i18next';
import { CreateContactGroupAssignmentRequest } from '@core/schema/contactGroup/createContactGroupAssignment/request.schema';
import { CsvFileReaderService } from '@core/services/csv.service';
import { ContactService } from '@core/services/contact.service';
import { IContactImportStatus } from '@core/common/interfaces/IContactImportStatus';
import { ICreateContact } from '@core/common/interfaces/ICreateContact';
import { buildCandidatesWithDdi } from '@core/common/functions/buildCandidatesBR';
import { EncryptService } from '@core/services/encrypt.service';
import { onlyDigits } from '@core/common/functions/onlyDigits';
import { extractPhoneAndDdi } from '@core/common/functions/extractPhoneAndDdi';

@injectable()
export class ContactGroupAssignmentCreatorUseCase {
  constructor(
    private readonly csvFileReaderService: CsvFileReaderService,
    private readonly contactService: ContactService,
    private readonly encryptService: EncryptService
  ) {}

  private buildCompletePhone(
    phoneDdi: string | null | undefined,
    phone: string | null | undefined
  ): string {
    return `${phoneDdi}${phone}`;
  }

  private createStatusResult(
    contact: Pick<ICreateContact, 'phone' | 'phone_ddi'>,
    status: IContactImportStatus['status'],
    message: string
  ): IContactImportStatus {
    return {
      phone: contact.phone ?? '',
      phone_ddi: contact.phone_ddi || null,
      phone_complete: this.buildCompletePhone(contact.phone_ddi, contact.phone),
      status,
      message,
    };
  }

  private validateBrazilianPhone(
    t: TFunction<'translation', undefined>,
    phone: string,
    phoneDdi: string
  ): { isValid: boolean; message?: string } {
    if (phoneDdi !== '55') return { isValid: true };

    const phoneDigits = onlyDigits(phone);

    if (phoneDigits.length !== 10 && phoneDigits.length !== 11) {
      return {
        isValid: false,
        message: t('brazilian_phone_must_have_10_or_11_digits'),
      };
    }

    const number = phoneDigits.slice(2);

    if (number.length !== 8 && number.length !== 9) {
      return {
        isValid: false,
        message: t('brazilian_phone_must_have_ddd_and_8_or_9_digits'),
      };
    }

    return { isValid: true };
  }

  private normalizePhoneFromValidation(
    defaultPhone: string | null | undefined = '',
    defaultDdi: string | null | undefined = '55'
  ): { phone: string; phoneDdi: string } {
    const phone = defaultPhone ?? '';
    const ddi = defaultDdi ?? '55';

    const validationPhone = `${ddi}${phone}`;

    const normalizedPhone = extractPhoneAndDdi(validationPhone);
    if (normalizedPhone) {
      return {
        phone: normalizedPhone.phone,
        phoneDdi: normalizedPhone.phone_ddi,
      };
    }

    return { phone, phoneDdi: ddi };
  }

  private async processContact(
    t: TFunction<'translation', undefined>,
    contact: ICreateContact,
    phonesC: string[],
    accountId: string,
    contactGroupId: string
  ): Promise<IContactImportStatus> {
    const phoneExists = await this.contactService.existsContactByPhone(phonesC);

    if (phoneExists) {
      return this.createStatusResult(
        contact,
        'duplicate',
        t('contact_already_exists_phone')
      );
    }

    const { phone: phoneToSave, phoneDdi: phoneDdiToSave } =
      this.normalizePhoneFromValidation(contact.phone, contact.phone_ddi);

    const contactCreated = await this.contactService.createContactWithGroup(
      t,
      {
        ...contact,
        phone: phoneToSave,
        phone_ddi: phoneDdiToSave,
      },
      contactGroupId,
      accountId,
      false
    );

    if (!contactCreated) {
      return this.createStatusResult(
        contact,
        'duplicate',
        t('contact_already_exists_phone')
      );
    }

    return this.createStatusResult(
      contact,
      'valid',
      t('contact_creator_success')
    );
  }

  async execute(
    t: TFunction<'translation', undefined>,
    input: CreateContactGroupAssignmentRequest,
    accountId: string
  ): Promise<IContactImportStatus[]> {
    if (!input.contacts) return [];

    const contacts = await this.csvFileReaderService.read(input.contacts);

    if (!contacts.length) {
      throw new Error(t('no_contacts_found_in_file'));
    }

    const contactGroupId = input?.contact_group_id?.value ?? '';
    const results: IContactImportStatus[] = [];

    for (const contact of contacts) {
      const phone = contact?.phone;
      const phoneDdi = contact.phone_ddi ?? '55';

      if (!phone) {
        results.push(
          this.createStatusResult(
            contact,
            'no_phone',
            t('phone_required_for_validation')
          )
        );

        continue;
      }

      const validation = this.validateBrazilianPhone(t, phone, phoneDdi);
      if (!validation.isValid) {
        results.push(
          this.createStatusResult(
            contact,
            'invalid',
            validation.message || t('invalid_phone_format')
          )
        );

        continue;
      }

      const phones = buildCandidatesWithDdi(phone, phoneDdi);
      const phonesC = phones.map((phone) => this.encryptService.encrypt(phone));

      const result = await this.processContact(
        t,
        contact,
        phonesC,
        accountId,
        contactGroupId
      );

      results.push(result);
    }

    return results;
  }
}
