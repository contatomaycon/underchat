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

  private async validateDuplicateContact(
    t: TFunction<'translation', undefined>,
    emailC: string | null,
    phonesC: string[],
    contactId: string
  ): Promise<void> {
    if (!emailC && !phonesC.length) return;

    const [emailExists, phoneExists] = await Promise.all([
      emailC
        ? this.contactService.existsContactByEmail(emailC, contactId)
        : Promise.resolve(false),
      phonesC.length > 0
        ? this.contactService.existsContactByPhone(phonesC, contactId)
        : Promise.resolve(false),
    ]);

    if (emailExists) {
      throw new Error(t('contact_already_exists_email'));
    }

    if (phoneExists) {
      throw new Error(t('contact_already_exists_phone'));
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

    if (
      body?.birthday &&
      typeof body.birthday === 'string' &&
      body.birthday.trim() !== ''
    ) {
      this.validateBirthDate(t, body.birthday);
    }

    const emailC = body.email ? this.encryptService.encrypt(body.email) : null;

    const phones = buildCandidatesWithDdi(body.phone, body.phone_ddi);
    const phonesC = phones.map((phone) => this.encryptService.encrypt(phone));

    await this.validateDuplicateContact(t, emailC, phonesC, contactId);

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
