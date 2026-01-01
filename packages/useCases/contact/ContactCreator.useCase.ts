import { injectable } from 'tsyringe';
import { TFunction } from 'i18next';
import { AccountService } from '@core/services/account.service';
import { LabelTemplateService } from '@core/services/labelTemplate.service';
import { CreateContactRequest } from '@core/schema/contact/createContact/request.schema';
import { ContactService } from '@core/services/contact.service';
import { EncryptService } from '@core/services/encrypt.service';
import { PhoneValidationService } from '@core/services/phoneValidation.service';
import moment from 'moment';
import { buildCandidatesWithDdi } from '@core/common/functions/buildCandidatesBR';
import { extractPhoneAndDdi } from '@core/common/functions/extractPhoneAndDdi';
import { ChatService } from '@core/services/chat.service';
import { CentrifugoService } from '@core/services/centrifugo.service';
import {
  chatAccountCentrifugo,
  chatQueueAccountCentrifugo,
} from '@core/common/functions/centrifugoQueue';
import { IChat } from '@core/common/interfaces/IChat';
import { PlanAccountService } from '@core/services/planAccount.service';

type FieldValue = string | { value: string } | null;

@injectable()
export class ContactCreatorUseCase {
  constructor(
    private readonly labelTemplateService: LabelTemplateService,
    private readonly accountService: AccountService,
    private readonly contactService: ContactService,
    private readonly encryptService: EncryptService,
    private readonly phoneValidationService: PhoneValidationService,
    private readonly chatService: ChatService,
    private readonly centrifugoService: CentrifugoService,
    private readonly planAccountService: PlanAccountService
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

  private encryptContactData(
    phone: string | null,
    phoneDdi: string | null,
    email: string | null
  ): {
    emailC: string | null;
    phonesC: string[];
  } {
    const phones =
      phone && phoneDdi ? buildCandidatesWithDdi(phone, phoneDdi) : [];
    const phonesC = phones.map((phone) => this.encryptService.encrypt(phone));

    return {
      emailC: email ? this.encryptService.encrypt(email) : null,
      phonesC: phone ? phonesC : [],
    };
  }

  private async checkContactExistence(
    accountId: string,
    emailC: string | null,
    phonesC: string[]
  ): Promise<{ emailExists: boolean; phoneExists: boolean }> {
    const [emailExists, phoneExists] = await Promise.all([
      emailC
        ? this.contactService.existsContactByEmail(accountId, emailC)
        : Promise.resolve(false),
      phonesC && phonesC.length > 0
        ? this.contactService.existsContactByPhone(accountId, phonesC)
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
  ): { shouldSkipValidation: boolean } | never {
    if (error instanceof Error) {
      const errorMessage = error.message.toLowerCase();
      if (errorMessage.includes('timeout')) {
        throw new Error(t('phone_validation_timeout'));
      }
      if (
        errorMessage.includes('no active worker') ||
        errorMessage.includes('no active worker found')
      ) {
        return { shouldSkipValidation: true };
      }
    }

    throw error;
  }

  private async validateAndNormalizePhone(
    t: TFunction<'translation', undefined>,
    accountId: string,
    phone: string,
    phoneDdi?: string | null
  ): Promise<{ phone: string; phoneDdi: string | null; isValidated: boolean }> {
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
        return { phone, phoneDdi: phoneDdi ?? null, isValidated: true };
      }

      const normalizedPhone = extractPhoneAndDdi(validationResult.phone);
      if (normalizedPhone) {
        return {
          phone: normalizedPhone.phone,
          phoneDdi: normalizedPhone.phone_ddi,
          isValidated: true,
        };
      }

      return { phone, phoneDdi: phoneDdi ?? null, isValidated: true };
    } catch (error) {
      const validationResult = this.handlePhoneValidationError(t, error);
      if (validationResult.shouldSkipValidation) {
        return { phone, phoneDdi: phoneDdi ?? null, isValidated: false };
      }

      throw error;
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
    input: CreateContactRequest,
    accountId: string
  ): Promise<boolean> {
    const labelTemplateId = this.extractFieldValue(
      input.label_template_id as FieldValue
    );
    const name = this.extractFieldValue(input.name as FieldValue);
    const lastName = this.extractFieldValue(input.last_name as FieldValue);
    const email = this.extractFieldValue(input.email as FieldValue);
    const phoneDdi = this.extractFieldValue(input.phone_ddi as FieldValue);
    const phone = this.extractFieldValue(input.phone as FieldValue);
    const nickname = this.extractFieldValue(input.nickname as FieldValue);
    const birthday = this.extractFieldValue(input.birthday as FieldValue);
    const notes = this.extractFieldValue(input.notes as FieldValue);

    if (!name) {
      throw new Error(t('name_required'));
    }

    if (!phoneDdi) {
      throw new Error(t('phone_ddi_required'));
    }

    if (!phone) {
      throw new Error(t('phone_required'));
    }

    await this.validateAccountAndLabelTemplate(t, accountId, labelTemplateId);
    await this.planAccountService.validateCanCreateContact(t, accountId);

    this.validateBirthdayIfPresent(t, birthday);

    const { emailC, phonesC } = this.encryptContactData(phone, phoneDdi, email);

    const { emailExists, phoneExists } = await this.checkContactExistence(
      accountId,
      emailC,
      phonesC
    );

    this.validateContactNotExists(t, emailExists, phoneExists);

    let phoneToSave = phone;
    let phoneDdiToSave = phoneDdi;
    let isValidated = true;

    if (phone) {
      const normalized = await this.validateAndNormalizePhone(
        t,
        accountId,
        phone,
        phoneDdi
      );

      phoneToSave = normalized.phone;
      phoneDdiToSave = normalized.phoneDdi ?? '55';
      isValidated = normalized.isValidated;
    }

    const contactToCreate: CreateContactRequest = {
      label_template_id: labelTemplateId,
      name,
      last_name: lastName,
      email,
      phone_ddi: phoneDdiToSave,
      phone: phoneToSave,
      nickname,
      birthday,
      notes,
      photo: input.photo,
      image_url: input.image_url,
    };

    const contactId = await this.contactService.createContact(
      contactToCreate,
      accountId,
      isValidated
    );

    if (!contactId) {
      throw new Error(t('contact_creation_failed'));
    }

    const chatId = this.extractFieldValue(input.chat_id as FieldValue);

    if (chatId) {
      await this.updateChatWithContactData(
        accountId,
        chatId,
        contactId,
        phoneToSave,
        phoneDdiToSave
      );
    }

    return true;
  }

  private async updateChatWithContactData(
    accountId: string,
    chatId: string,
    contactId: string,
    phone: string,
    phoneDdi: string
  ): Promise<void> {
    const chat = await this.chatService.findChatByChatId(accountId, chatId);
    if (!chat) return;

    const contact = await this.contactService.getContactById(
      contactId,
      accountId
    );
    if (!contact) return;

    const updatedChat: IChat = {
      ...chat,
      contact: {
        id: contact.contact_id,
        name: contact.name,
        phone: contact.phone_partial ?? phone ?? chat.phone ?? '',
        phone_ddi:
          contact.phone_ddi ?? phoneDdi ?? chat.contact?.phone_ddi ?? null,
        photo: contact.photo ?? null,
      },
    };

    const saved = await this.chatService.saveChat(updatedChat);
    if (!saved) return;

    const channelAccountId = updatedChat.account?.id ?? accountId;

    await Promise.all([
      this.centrifugoService.publishSub(
        chatAccountCentrifugo(channelAccountId),
        updatedChat
      ),
      this.centrifugoService.publishSub(
        chatQueueAccountCentrifugo(channelAccountId),
        updatedChat
      ),
    ]);
  }
}
