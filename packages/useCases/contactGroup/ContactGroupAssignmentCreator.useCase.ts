import { injectable } from 'tsyringe';
import { TFunction } from 'i18next';
import { CreateContactGroupAssignmentRequest } from '@core/schema/contactGroup/createContactGroupAssignment/request.schema';
import { CsvFileReaderService } from '@core/services/csv.service';
import { ContactService } from '@core/services/contact.service';
import { PhoneValidationService } from '@core/services/phoneValidation.service';
import { IContactImportStatus } from '@core/common/interfaces/IContactImportStatus';
import { onlyDigits } from '@core/common/functions/onlyDigits';

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

    const results: IContactImportStatus[] = [];

    for (const contact of contacts) {
      const phoneComplete = this.buildCompletePhone(
        contact.phone_ddi,
        contact.phone
      );

      if (!contact.phone) {
        results.push({
          phone: contact.phone ?? '',
          phone_ddi: contact.phone_ddi ?? null,
          phone_complete: phoneComplete,
          status: 'no_phone',
          message: t('phone_required_for_validation'),
        });
        continue;
      }

      try {
        const validationResult =
          await this.phoneValidationService.validatePhone(
            accountId,
            contact.phone,
            contact.phone_ddi || '55'
          );

        if (!validationResult.valid) {
          results.push({
            phone: contact.phone,
            phone_ddi: contact.phone_ddi || null,
            phone_complete: phoneComplete,
            status: 'invalid',
            message: t('phone_number_not_valid_on_whatsapp'),
          });
          continue;
        }

        const contactCreated = await this.contactService.createContactTx(
          t,
          {
            ...contact,
            phone_ddi: contact.phone_ddi || '55',
          },
          input?.contact_group_id?.value ?? '',
          accountId
        );

        if (!contactCreated) {
          results.push({
            phone: contact.phone,
            phone_ddi: contact.phone_ddi || null,
            phone_complete: phoneComplete,
            status: 'duplicate',
            message: t('contact_already_exists_phone'),
          });
          continue;
        }

        results.push({
          phone: contact.phone,
          phone_ddi: contact.phone_ddi || null,
          phone_complete: validationResult.phone || phoneComplete,
          status: 'valid',
          message: t('contact_creator_success'),
          contact_id: contactCreated ? 'created' : null,
        });
      } catch (error) {
        const errorStatus = this.getErrorStatus(t, error);
        results.push({
          phone: contact.phone,
          phone_ddi: contact.phone_ddi || null,
          phone_complete: phoneComplete,
          status: errorStatus.status,
          message: errorStatus.message,
        });
      }
    }

    return results;
  }
}
