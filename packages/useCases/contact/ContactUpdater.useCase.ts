import { injectable } from 'tsyringe';
import { TFunction } from 'i18next';
import { UpdateContactRequest } from '@core/schema/contact/editContact/request.schema';
import { ContactService } from '@core/services/contact.service';
import { LabelTemplateService } from '@core/services/labelTemplate.service';
import { ContactExistsByEmailAndPhoneRepository } from '@core/repositories/contact/ContactExistsByEmailAndPhone.repository';
import { EncryptService } from '@core/services/encrypt.service';

@injectable()
export class ContactUpdaterUseCase {
  constructor(
    private readonly contactService: ContactService,
    private readonly labelTemplateService: LabelTemplateService,
    private readonly contactExistsByEmailAndPhoneRepository: ContactExistsByEmailAndPhoneRepository,
    private readonly encryptService: EncryptService
  ) {}

  private async validateDuplicateContact(
    t: TFunction<'translation', undefined>,
    emailC: string | null,
    phoneC: string | null,
    contactId: string
  ): Promise<void> {
    if (!emailC && !phoneC) {
      return;
    }

    const [emailExists, phoneExists] = await Promise.all([
      emailC
        ? this.contactExistsByEmailAndPhoneRepository.existsContactByEmail(
            emailC,
            contactId
          )
        : Promise.resolve(false),
      phoneC
        ? this.contactExistsByEmailAndPhoneRepository.existsContactByPhone(
            phoneC,
            contactId
          )
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

    const emailC = body.email ? this.encryptService.encrypt(body.email) : null;
    const phoneC = body.phone ? this.encryptService.encrypt(body.phone) : null;

    await this.validateDuplicateContact(t, emailC, phoneC, contactId);

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
