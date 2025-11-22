import { injectable } from 'tsyringe';
import { TFunction } from 'i18next';
import { UpdateContactRequest } from '@core/schema/contact/editContact/request.schema';
import { ContactService } from '@core/services/contact.service';
import { LabelTemplateService } from '@core/services/labelTemplate.service';
import { EncryptService } from '@core/services/encrypt.service';
import moment from 'moment';
import { buildCandidatesWithDdi } from '@core/common/functions/buildCandidatesBR';

@injectable()
export class ContactUpdaterUseCase {
  constructor(
    private readonly contactService: ContactService,
    private readonly labelTemplateService: LabelTemplateService,
    private readonly encryptService: EncryptService
  ) {}

  private async validatePhone(
    t: TFunction<'translation', undefined>,
    contactId: string,
    phone?: string | null,
    phoneDdi?: string | null
  ) {
    if (!phone) return;
    if (!phoneDdi) throw new Error(t('phone_ddi_required'));

    const phones = buildCandidatesWithDdi(phone, phoneDdi);
    const phonesC = phones.map((phone) => this.encryptService.encrypt(phone));

    await this.validatePhoneDuplicateContact(t, phonesC, contactId);
  }

  private async validateEmail(
    t: TFunction<'translation', undefined>,
    contactId: string,
    email?: string | null
  ) {
    if (!email) return;

    const emailC = this.encryptService.encrypt(email);

    await this.validateEmailDuplicateContact(t, emailC, contactId);
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
    contactId: string
  ): Promise<void> {
    const phoneExists = await this.contactService.existsContactByPhone(
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
    contactId: string
  ): Promise<void> {
    const emailExists = await this.contactService.existsContactByEmail(
      emailC,
      contactId
    );

    if (emailExists) {
      throw new Error(t('contact_already_exists_email'));
    }
  }

  async execute(
    t: TFunction<'translation', undefined>,
    contactId: string,
    body: UpdateContactRequest
  ): Promise<boolean> {
    const contactExists =
      await this.contactService.existsContactById(contactId);

    if (!contactExists) {
      throw new Error(t('contact_not_found'));
    }

    if (body?.label_template_id) {
      const labelTemplateExists =
        await this.labelTemplateService.existsLabelTemplateById(
          body.label_template_id
        );

      if (!labelTemplateExists) {
        throw new Error(t('label_template_not_found'));
      }
    }

    this.validateBirthDate(t, body.birthday);

    await Promise.all([
      this.validatePhone(t, contactId, body.phone, body.phone_ddi),
      this.validateEmail(t, contactId, body.email),
    ]);

    const contactUpdater = await this.contactService.updateContactById(
      body,
      contactId
    );

    if (!contactUpdater) {
      throw new Error(t('contact_update_error'));
    }

    return true;
  }
}
