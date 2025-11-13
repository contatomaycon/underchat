import { injectable } from 'tsyringe';
import { TFunction } from 'i18next';
import { AccountService } from '@core/services/account.service';
import { LabelTemplateService } from '@core/services/labelTemplate.service';
import { CreateContactRequest } from '@core/schema/contact/createContact/request.schema';
import { ContactService } from '@core/services/contact.service';
import moment from 'moment';

@injectable()
export class ContactCreatorUseCase {
  constructor(
    private readonly labelTemplateService: LabelTemplateService,
    private readonly accountService: AccountService,
    private readonly contactService: ContactService
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

  async execute(
    t: TFunction<'translation', undefined>,
    input: CreateContactRequest,
    accountId: string
  ): Promise<boolean> {
    const accountExists =
      await this.accountService.existsAccountById(accountId);

    if (!accountExists) {
      throw new Error(t('account_not_found'));
    }

    if (input?.label_template_id) {
      const labelTemplateExists =
        await this.labelTemplateService.existsLabelTemplateById(
          input.label_template_id
        );

      if (!labelTemplateExists) {
        throw new Error(t('label_template_not_found'));
      }
    }

    if (input?.birthday) {
      this.validateBirthDate(t, input.birthday);
    }

    const contactId = await this.contactService.createContact(input, accountId);

    if (!contactId) {
      throw new Error(t('contact_creation_failed'));
    }

    return true;
  }
}
