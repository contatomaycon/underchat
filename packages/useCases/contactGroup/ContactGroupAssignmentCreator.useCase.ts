import { injectable } from 'tsyringe';
import { TFunction } from 'i18next';
import { CreateContactGroupAssignmentRequest } from '@core/schema/contactGroup/createContactGroupAssignment/request.schema';
import { CsvFileReaderService } from '@core/services/csv.service';
import { ContactService } from '@core/services/contact.service';
import { PhoneValidationService } from '@core/services/phoneValidation.service';
import { IContactImportStatus } from '@core/common/interfaces/IContactImportStatus';
import { ICreateContact } from '@core/common/interfaces/ICreateContact';
import { onlyDigits } from '@core/common/functions/onlyDigits';
import { normalizePhoneNumber } from '@core/common/functions/normalizePhoneNumber';

@injectable()
export class ContactGroupAssignmentCreatorUseCase {
  constructor(
    private readonly csvFileReaderService: CsvFileReaderService,
    private readonly contactService: ContactService,
    private readonly phoneValidationService: PhoneValidationService
  ) {}

  private buildCompletePhone(
    phoneDdi: string | null | undefined,
    phone: string | null | undefined
  ): string {
    if (!phone) return '';
    const normalizedPhone = onlyDigits(phone);
    const normalizedDdi = phoneDdi ? onlyDigits(phoneDdi) : '55';
    return `${normalizedDdi}${normalizedPhone}`;
  }

  private getErrorStatus(
    t: TFunction<'translation', undefined>,
    error: unknown
  ): { status: IContactImportStatus['status']; message: string } {
    const defaultMessage = t('contact_creation_failed');
    const defaultStatus: IContactImportStatus['status'] = 'error';

    if (!(error instanceof Error)) {
      return { status: defaultStatus, message: defaultMessage };
    }

    if (error.message.includes('timeout')) {
      return { status: 'error', message: t('phone_validation_timeout') };
    }

    if (error.message.includes('No active worker')) {
      return { status: 'error', message: t('no_active_worker_for_validation') };
    }

    if (error.message.includes('already exists')) {
      return {
        status: 'duplicate',
        message: t('contact_already_exists_phone'),
      };
    }

    return { status: defaultStatus, message: error.message };
  }

  private createStatusResult(
    contact: Pick<ICreateContact, 'phone' | 'phone_ddi'>,
    phoneComplete: string,
    status: IContactImportStatus['status'],
    message: string,
    phoneCompleteOverride?: string
  ): IContactImportStatus {
    return {
      phone: contact.phone ?? '',
      phone_ddi: contact.phone_ddi || null,
      phone_complete: phoneCompleteOverride || phoneComplete,
      status,
      message,
    };
  }

  private normalizePhoneFromValidation(
    validationPhone: string | null | undefined,
    defaultPhone: string | null | undefined = '',
    defaultDdi: string | null | undefined = '55'
  ): { phone: string; phoneDdi: string } {
    const phone = defaultPhone ?? '';
    const ddi = defaultDdi ?? '55';

    if (!validationPhone) {
      return { phone, phoneDdi: ddi };
    }

    const normalizedPhone = normalizePhoneNumber(validationPhone);
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
    phoneComplete: string,
    accountId: string,
    contactGroupId: string
  ): Promise<IContactImportStatus> {
    if (!contact.phone) {
      return this.createStatusResult(
        contact,
        phoneComplete,
        'no_phone',
        t('phone_required_for_validation')
      );
    }

    try {
      const validationResult = await this.phoneValidationService.validatePhone(
        accountId,
        contact.phone,
        contact.phone_ddi || '55'
      );

      if (!validationResult.valid) {
        return this.createStatusResult(
          contact,
          phoneComplete,
          'invalid',
          t('phone_number_not_valid_on_whatsapp')
        );
      }

      const { phone: phoneToSave, phoneDdi: phoneDdiToSave } =
        this.normalizePhoneFromValidation(
          validationResult.phone,
          contact.phone ?? '',
          contact.phone_ddi ?? '55'
        );

      const contactCreated = await this.contactService.createContactTx(
        t,
        {
          ...contact,
          phone: phoneToSave,
          phone_ddi: phoneDdiToSave,
        },
        contactGroupId,
        accountId
      );

      if (!contactCreated) {
        return this.createStatusResult(
          contact,
          phoneComplete,
          'duplicate',
          t('contact_already_exists_phone')
        );
      }

      return this.createStatusResult(
        contact,
        phoneComplete,
        'valid',
        t('contact_creator_success'),
        validationResult.phone || phoneComplete
      );
    } catch (error) {
      const errorStatus = this.getErrorStatus(t, error);
      return this.createStatusResult(
        contact,
        phoneComplete,
        errorStatus.status,
        errorStatus.message
      );
    }
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
      const phoneComplete = this.buildCompletePhone(
        contact.phone_ddi,
        contact.phone
      );

      const result = await this.processContact(
        t,
        contact,
        phoneComplete,
        accountId,
        contactGroupId
      );

      results.push(result);
    }

    return results;
  }
}
