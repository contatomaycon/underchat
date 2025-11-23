import { injectable } from 'tsyringe';
import { TFunction } from 'i18next';
import { UpdateContactRequest } from '@core/schema/contact/editContact/request.schema';
import { ContactService } from '@core/services/contact.service';
import { LabelTemplateService } from '@core/services/labelTemplate.service';
import { EncryptService } from '@core/services/encrypt.service';
import moment from 'moment';
import { buildCandidatesWithDdi } from '@core/common/functions/buildCandidatesBR';
import { PhoneValidationService } from '@core/services/phoneValidation.service';
import { extractPhoneAndDdi } from '@core/common/functions/extractPhoneAndDdi';

@injectable()
export class ContactUpdaterUseCase {
  constructor(
    private readonly contactService: ContactService,
    private readonly labelTemplateService: LabelTemplateService,
    private readonly encryptService: EncryptService,
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

  private async validatePhone(
    t: TFunction<'translation', undefined>,
    accountId: string,
    contactId: string,
    phone?: string | null,
    phoneDdi?: string | null
  ): Promise<{ phone: string; phoneDdi: string | null } | undefined> {
    if (!phone && !phoneDdi) return;

    if (!phoneDdi) {
      throw new Error(t('phone_ddi_required'));
    }

    const currentContact = await this.contactService.viewContactById(
      contactId,
      accountId
    );

    const currentDdi = currentContact?.phone_ddi ?? null;
    const newDdi = phoneDdi ?? null;
    const ddiChanged = String(currentDdi) !== String(newDdi);

    if (!ddiChanged) {
      if (!currentContact?.phone) {
        return;
      }

      const currentPhoneDecrypted =
        this.contactService.getContactPhoneDecrypted(currentContact.phone);

      if (!currentPhoneDecrypted) {
        return;
      }

      return {
        phone: currentPhoneDecrypted,
        phoneDdi: phoneDdi,
      };
    }

    let phoneToValidate = phone;

    if (!phoneToValidate) {
      if (!currentContact?.phone) {
        throw new Error(t('phone_required_when_ddi_provided'));
      }

      phoneToValidate = this.contactService.getContactPhoneDecrypted(
        currentContact.phone
      );

      if (!phoneToValidate) {
        throw new Error(t('phone_not_found_or_cannot_be_decrypted'));
      }
    }

    const phones = buildCandidatesWithDdi(phoneToValidate, phoneDdi);
    const phonesC = phones.map((phone) => this.encryptService.encrypt(phone));

    await this.validatePhoneDuplicateContact(t, phonesC, accountId, contactId);

    const normalized = await this.validateAndNormalizePhone(
      t,
      accountId,
      phoneToValidate,
      phoneDdi
    );

    return normalized;
  }

  private async validateEmail(
    t: TFunction<'translation', undefined>,
    accountId: string,
    contactId: string,
    email?: string | null
  ) {
    if (!email) return;

    const emailC = this.encryptService.encrypt(email);

    await this.validateEmailDuplicateContact(t, emailC, accountId, contactId);
  }

  private validateBirthDate(
    t: TFunction<'translation', undefined>,
    birthDate?: string | null
  ) {
    if (!birthDate) return;
    if (typeof birthDate !== 'string' || birthDate.trim() === '') return;

    if (!moment(birthDate, 'YYYY-MM-DD', true).isValid()) {
      throw new Error(t('date_must_be_in_the_format_yyyy_mm_dd'));
    }

    const birth = moment(birthDate, 'YYYY-MM-DD');
    const minDate = moment('1900-01-01', 'YYYY-MM-DD');
    const today = moment().startOf('day');

    if (birth.isBefore(minDate)) {
      throw new Error(t('date_must_be_greater_than_1900_01_01'));
    }

    if (!birth.isBefore(today)) {
      throw new Error(t('date_must_be_less_than_today'));
    }
  }

  private async validatePhoneDuplicateContact(
    t: TFunction<'translation', undefined>,
    phonesC: string[],
    accountId: string,
    contactId: string
  ): Promise<void> {
    const phoneExists = await this.contactService.existsContactByPhone(
      accountId,
      phonesC,
      contactId
    );

    if (phoneExists) {
      throw new Error(t('contact_already_exists_phone'));
    }
  }

  private async validateEmailDuplicateContact(
    t: TFunction<'translation', undefined>,
    emailC: string,
    accountId: string,
    contactId: string
  ): Promise<void> {
    const emailExists = await this.contactService.existsContactByEmail(
      accountId,
      emailC,
      contactId
    );

    if (emailExists) {
      throw new Error(t('contact_already_exists_email'));
    }
  }

  private extractFieldValue(
    field: string | { value: string } | null | undefined
  ): string | null {
    if (field === null || field === undefined) {
      return null;
    }

    if (typeof field === 'object' && 'value' in field) {
      return field.value ?? null;
    }

    if (typeof field === 'string') {
      return field;
    }

    return null;
  }

  async execute(
    t: TFunction<'translation', undefined>,
    accountId: string,
    contactId: string,
    body: UpdateContactRequest
  ): Promise<boolean> {
    const contactExists =
      await this.contactService.existsContactById(contactId);

    if (!contactExists) {
      throw new Error(t('contact_not_found'));
    }

    const labelTemplateId = this.extractFieldValue(
      body.label_template_id as string | { value: string } | null
    );
    const name = this.extractFieldValue(
      body.name as string | { value: string } | null
    );
    const lastName = this.extractFieldValue(
      body.last_name as string | { value: string } | null
    );
    const email = this.extractFieldValue(
      body.email as string | { value: string } | null
    );
    const phoneDdi = this.extractFieldValue(
      body.phone_ddi as string | { value: string } | null
    );
    const phone = this.extractFieldValue(
      body.phone as string | { value: string } | null
    );
    const nickname = this.extractFieldValue(
      body.nickname as string | { value: string } | null
    );
    const birthday = this.extractFieldValue(
      body.birthday as string | { value: string } | null
    );
    const notes = this.extractFieldValue(
      body.notes as string | { value: string } | null
    );

    if (labelTemplateId) {
      const labelTemplateExists =
        await this.labelTemplateService.existsLabelTemplateById(
          labelTemplateId
        );

      if (!labelTemplateExists) {
        throw new Error(t('label_template_not_found'));
      }
    }

    this.validateBirthDate(t, birthday);

    const [normalizedPhone] = await Promise.all([
      this.validatePhone(t, accountId, contactId, phone, phoneDdi),
      this.validateEmail(t, accountId, contactId, email),
    ]);

    const bodyToUpdate: UpdateContactRequest = {
      label_template_id: labelTemplateId,
      name,
      last_name: lastName,
      email,
      phone_ddi: normalizedPhone?.phoneDdi ?? phoneDdi,
      phone: normalizedPhone?.phone ?? phone,
      nickname,
      birthday,
      notes,
      photo: body.photo,
    };

    const contactUpdater = await this.contactService.updateContactById(
      bodyToUpdate,
      contactId,
      accountId
    );

    if (!contactUpdater) {
      throw new Error(t('contact_update_error'));
    }

    return true;
  }
}
