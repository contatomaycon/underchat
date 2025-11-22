import { injectable } from 'tsyringe';
import { TFunction } from 'i18next';
import { AccountService } from '@core/services/account.service';
import { LabelTemplateService } from '@core/services/labelTemplate.service';
import { CreateContactRequest } from '@core/schema/contact/createContact/request.schema';
import { ContactService } from '@core/services/contact.service';
import { ContactExistsByEmailAndPhoneRepository } from '@core/repositories/contact/ContactExistsByEmailAndPhone.repository';
import { EncryptService } from '@core/services/encrypt.service';
import { PhoneValidationService } from '@core/services/phoneValidation.service';
import { normalizePhoneNumber } from '@core/common/functions/normalizePhoneNumber';
import moment from 'moment';
import { buildCandidates } from '@core/common/functions/buildCandidatesBR';

@injectable()
export class ContactCreatorUseCase {
  constructor(
    private readonly labelTemplateService: LabelTemplateService,
    private readonly accountService: AccountService,
    private readonly contactService: ContactService,
    private readonly contactExistsByEmailAndPhoneRepository: ContactExistsByEmailAndPhoneRepository,
    private readonly encryptService: EncryptService,
    private readonly phoneValidationService: PhoneValidationService
  ) {}

  private validateBirthDate(
    t: TFunction<'translation', undefined>,
    birthDate: string
  ) {
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

  private async validateAccountAndLabelTemplate(
    t: TFunction<'translation', undefined>,
    accountId: string,
    labelTemplateId?: string | null
  ): Promise<void> {
    const accountExists =
      await this.accountService.existsAccountById(accountId);

    if (!accountExists) {
      throw new Error(t('account_not_found'));
    }

    if (labelTemplateId) {
      const labelTemplateExists =
        await this.labelTemplateService.existsLabelTemplateById(
          labelTemplateId
        );

      if (!labelTemplateExists) {
        throw new Error(t('label_template_not_found'));
      }
    }
  }

  private validateBirthdayIfPresent(
    t: TFunction<'translation', undefined>,
    birthday?: string | null
  ): void {
    if (!birthday || typeof birthday !== 'string' || birthday.trim() === '') {
      return;
    }

    this.validateBirthDate(t, birthday);
  }

  private encryptContactData(input: CreateContactRequest): {
    emailC: string | null;
    phonesC: string[];
  } {
    const phones = buildCandidates(input.phone);
    const phonesC = phones.map((phone) => this.encryptService.encrypt(phone));

    return {
      emailC: input.email ? this.encryptService.encrypt(input.email) : null,
      phonesC: input.phone ? phonesC : [],
    };
  }

  private async checkContactExistence(
    emailC: string | null,
    phonesC: string[]
  ): Promise<{ emailExists: boolean; phoneExists: boolean }> {
    const [emailExists, phoneExists] = await Promise.all([
      emailC
        ? this.contactExistsByEmailAndPhoneRepository.existsContactByEmail(
            emailC
          )
        : Promise.resolve(false),
      phonesC && phonesC.length > 0
        ? this.contactExistsByEmailAndPhoneRepository.existsContactByPhone(
            phonesC
          )
        : Promise.resolve(false),
    ]);

    return { emailExists, phoneExists };
  }

  private validateContactNotExists(
    t: TFunction<'translation', undefined>,
    emailExists: boolean,
    phoneExists: boolean
  ): void {
    if (emailExists) {
      throw new Error(t('contact_already_exists_email'));
    }

    if (phoneExists) {
      throw new Error(t('contact_already_exists_phone'));
    }
  }

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

      const normalizedPhone = normalizePhoneNumber(validationResult.phone);
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
    input: CreateContactRequest,
    accountId: string
  ): Promise<boolean> {
    await this.validateAccountAndLabelTemplate(
      t,
      accountId,
      input.label_template_id
    );

    this.validateBirthdayIfPresent(t, input.birthday);

    const { emailC, phonesC } = this.encryptContactData(input);

    const { emailExists, phoneExists } = await this.checkContactExistence(
      emailC,
      phonesC
    );

    this.validateContactNotExists(t, emailExists, phoneExists);

    let phoneToSave = input.phone;
    let phoneDdiToSave = input.phone_ddi;

    if (input.phone) {
      const normalized = await this.validateAndNormalizePhone(
        t,
        accountId,
        input.phone,
        input.phone_ddi
      );
      phoneToSave = normalized.phone;
      phoneDdiToSave = normalized.phoneDdi ?? '55';
    }

    const contactToCreate: CreateContactRequest = {
      ...input,
      phone: phoneToSave,
      phone_ddi: phoneDdiToSave,
    };

    const contactId = await this.contactService.createContact(
      contactToCreate,
      accountId
    );

    if (!contactId) {
      throw new Error(t('contact_creation_failed'));
    }

    return true;
  }
}
