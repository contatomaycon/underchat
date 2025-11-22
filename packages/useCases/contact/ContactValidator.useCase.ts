import { injectable } from 'tsyringe';
import { TFunction } from 'i18next';
import { ContactService } from '@core/services/contact.service';
import { PhoneValidationService } from '@core/services/phoneValidation.service';
import { extractPhoneAndDdi } from '@core/common/functions/extractPhoneAndDdi';

@injectable()
export class ContactValidatorUseCase {
  constructor(
    private readonly contactService: ContactService,
    private readonly phoneValidationService: PhoneValidationService
  ) {}

  private handlePhoneValidationError(
    t: TFunction<'translation', undefined>,
    error: unknown
  ): never {
    if (error instanceof Error) {
      if (error.message.includes('timeout')) {
        throw new Error(t('phone_validation_timeout'));
      }
      if (error.message.includes('No active worker')) {
        throw new Error(t('no_active_worker_for_validation'));
      }
    }
    throw error;
  }

  private async validateAndNormalizePhone(
    t: TFunction<'translation', undefined>,
    accountId: string,
    phone: string,
    phoneDdi?: string | null
  ): Promise<{ phone: string; phoneDdi: string | null }> {
    try {
      const validationResult = await this.phoneValidationService.validatePhone(
        accountId,
        phone,
        phoneDdi
      );

      if (!validationResult.valid) {
        throw new Error(t('phone_number_not_valid_on_whatsapp'));
      }

      if (!validationResult.phone) {
        return { phone, phoneDdi: phoneDdi ?? null };
      }

      const normalizedPhone = extractPhoneAndDdi(validationResult.phone);
      if (normalizedPhone) {
        return {
          phone: normalizedPhone.phone,
          phoneDdi: normalizedPhone.phone_ddi,
        };
      }

      return { phone, phoneDdi: phoneDdi ?? null };
    } catch (error) {
      this.handlePhoneValidationError(t, error);
    }
  }

  async execute(
    t: TFunction<'translation', undefined>,
    contactId: string,
    accountId: string
  ): Promise<boolean> {
    const contact = await this.contactService.getContactById(contactId);

    if (!contact) {
      throw new Error(t('contact_not_found'));
    }

    if (contact.is_valided) {
      throw new Error(t('contact_already_validated'));
    }

    if (!contact.phone_ddi) {
      throw new Error(t('phone_ddi_required'));
    }

    const sensitiveData =
      await this.contactService.getContactSensitiveDataDecrypted(contactId);

    if (!sensitiveData?.phone) {
      throw new Error(t('phone_required_for_validation'));
    }

    const decryptedPhone = sensitiveData.phone;

    const normalized = await this.validateAndNormalizePhone(
      t,
      accountId,
      decryptedPhone,
      contact.phone_ddi
    );

    const result = await this.contactService.validateContact(
      contactId,
      normalized.phone,
      normalized.phoneDdi
    );

    if (!result) {
      throw new Error(t('contact_validation_failed'));
    }

    return true;
  }
}
