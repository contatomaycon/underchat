import { injectable, inject } from 'tsyringe';
import { TFunction } from 'i18next';
import { CreateContactGroupAssignmentRequest } from '@core/schema/contactGroup/createContactGroupAssignment/request.schema';
import { CsvFileReaderService } from '@core/services/csv.service';
import { ContactService } from '@core/services/contact.service';
import { IContactImportStatus } from '@core/common/interfaces/IContactImportStatus';
import { ICreateContact } from '@core/common/interfaces/ICreateContact';
import { buildCandidatesWithDdi } from '@core/common/functions/buildCandidatesBR';
import { truncateContactName } from '@core/common/functions/truncateContactName';
import { EncryptService } from '@core/services/encrypt.service';
import { onlyDigits } from '@core/common/functions/onlyDigits';
import { extractPhoneAndDdi } from '@core/common/functions/extractPhoneAndDdi';
import { PlanAccountService } from '@core/services/planAccount.service';
import { CentrifugoService } from '@core/services/centrifugo.service';
import { LabelTemplateViewerByNameRepository } from '@core/repositories/labelTemplate/LabelTemplateViewerByName.repository';
import { LabelTemplateCreatorRepository } from '@core/repositories/labelTemplate/LabelTemplateCreator.repository';
import { ELabelStatus } from '@core/common/enums/ELabelStatus';

@injectable()
export class ContactGroupAssignmentCreatorUseCase {
  private labelCache: Map<string, string> = new Map();

  constructor(
    @inject(CsvFileReaderService)
    private readonly csvFileReaderService: CsvFileReaderService,
    @inject(ContactService)
    private readonly contactService: ContactService,
    @inject(EncryptService)
    private readonly encryptService: EncryptService,
    @inject(PlanAccountService)
    private readonly planAccountService: PlanAccountService,
    @inject(CentrifugoService)
    private readonly centrifugoService: CentrifugoService,
    @inject(LabelTemplateViewerByNameRepository)
    private readonly labelTemplateViewerByNameRepository: LabelTemplateViewerByNameRepository,
    @inject(LabelTemplateCreatorRepository)
    private readonly labelTemplateCreatorRepository: LabelTemplateCreatorRepository
  ) {}

  private buildCompletePhone(
    phoneDdi: string | null | undefined,
    phone: string | null | undefined
  ): string {
    return `${phoneDdi}${phone}`;
  }

  private createStatusResult(
    contact: Pick<ICreateContact, 'phone' | 'phone_ddi' | 'name' | 'last_name'>,
    status: IContactImportStatus['status'],
    message: string
  ): IContactImportStatus {
    return {
      phone: contact.phone ?? '',
      phone_ddi: contact.phone_ddi || null,
      phone_complete: this.buildCompletePhone(contact.phone_ddi, contact.phone),
      status,
      message,
      name: contact.name ?? null,
      last_name: contact.last_name ?? null,
    };
  }

  private validateBrazilianPhone(
    t: TFunction<'translation', undefined>,
    phone: string,
    phoneDdi: string
  ): { isValid: boolean; message?: string } {
    if (phoneDdi !== '55') return { isValid: true };

    const phoneDigits = onlyDigits(phone);

    if (phoneDigits.length !== 10 && phoneDigits.length !== 11) {
      return {
        isValid: false,
        message: t('brazilian_phone_must_have_10_or_11_digits'),
      };
    }

    const number = phoneDigits.slice(2);

    if (number.length !== 8 && number.length !== 9) {
      return {
        isValid: false,
        message: t('brazilian_phone_must_have_ddd_and_8_or_9_digits'),
      };
    }

    return { isValid: true };
  }

  private normalizePhoneFromValidation(
    defaultPhone: string | null | undefined = '',
    defaultDdi: string | null | undefined = '55'
  ): { phone: string; phoneDdi: string } {
    const phone = defaultPhone ?? '';
    const ddi = defaultDdi ?? '55';

    const validationPhone = `${ddi}${phone}`;

    const normalizedPhone = extractPhoneAndDdi(validationPhone);
    if (normalizedPhone) {
      return {
        phone: normalizedPhone.phone,
        phoneDdi: normalizedPhone.phone_ddi,
      };
    }

    return { phone, phoneDdi: ddi };
  }

  private truncateLabelName = (name: string, maxLength: number): string => {
    if (name.length <= maxLength) {
      return name;
    }
    return name.substring(0, maxLength);
  };

  private generateRandomColor = (): string => {
    const colors = [
      '#1976D2',
      '#388E3C',
      '#F57C00',
      '#7B1FA2',
      '#C2185B',
      '#00796B',
      '#0288D1',
      '#5D4037',
      '#455A64',
      '#E64A19',
    ];
    return colors[Math.floor(Math.random() * colors.length)];
  };

  private async resolveOrCreateLabel(
    accountId: string,
    labelName: string
  ): Promise<string | null> {
    if (!labelName || typeof labelName !== 'string') {
      return null;
    }

    const trimmedName = labelName.trim();
    if (!trimmedName) {
      return null;
    }

    const truncatedName = this.truncateLabelName(trimmedName, 255);
    const cacheKey = `${accountId}:${truncatedName.toLowerCase()}`;

    if (this.labelCache.has(cacheKey)) {
      return this.labelCache.get(cacheKey) ?? null;
    }

    const existingLabel =
      await this.labelTemplateViewerByNameRepository.viewLabelTemplateByName(
        accountId,
        truncatedName
      );

    if (existingLabel) {
      this.labelCache.set(cacheKey, existingLabel.label_template_id);
      return existingLabel.label_template_id;
    }

    const color = this.generateRandomColor();
    const labelTemplateId =
      await this.labelTemplateCreatorRepository.createLabelTemplate(
        {
          label: truncatedName,
          color,
          label_status: {
            label_status_id: ELabelStatus.active,
          },
        },
        accountId
      );

    if (labelTemplateId) {
      this.labelCache.set(cacheKey, labelTemplateId);
      return labelTemplateId;
    }

    return null;
  }

  private async processContact(
    t: TFunction<'translation', undefined>,
    contact: ICreateContact,
    phonesC: string[],
    accountId: string,
    contactGroupId: string | null
  ): Promise<IContactImportStatus> {
    try {
      const { phone: phoneToSave, phoneDdi: phoneDdiToSave } =
        this.normalizePhoneFromValidation(contact.phone, contact.phone_ddi);

      let labelTemplateIds: string[] = [];
      if (contact.label) {
        const labelTemplateId = await this.resolveOrCreateLabel(
          accountId,
          contact.label
        );
        if (labelTemplateId) {
          labelTemplateIds.push(labelTemplateId);
        }
      }

      const existingContact = await this.contactService.getContactByPhone(
        accountId,
        phoneToSave,
        phoneDdiToSave
      );

      if (existingContact) {
        const updated = await this.contactService.updateContactFromImport(
          existingContact.contact_id,
          accountId,
          contact
        );

        if (!updated) {
          return this.createStatusResult(
            contact,
            'invalid',
            t('contact_creation_failed')
          );
        }

        if (contactGroupId) {
          await this.contactService.addContactToGroupIfNotExists(
            existingContact.contact_id,
            contactGroupId
          );
        }

        if (labelTemplateIds.length > 0) {
          for (const labelTemplateId of labelTemplateIds) {
            await this.contactService.addContactLabelTemplateIfNotExists(
              existingContact.contact_id,
              labelTemplateId
            );
          }
        }

        return this.createStatusResult(
          contact,
          'duplicate',
          t('contact_import_updated')
        );
      }

      await this.planAccountService.validateCanCreateContact(t, accountId);

      const contactCreated = await this.contactService.createContactWithGroup(
        t,
        {
          ...contact,
          name: truncateContactName(contact.name) ?? contact.name ?? '',
          last_name:
            truncateContactName(contact.last_name) ?? contact.last_name ?? null,
          nickname:
            truncateContactName(contact.nickname) ?? contact.nickname ?? null,
          phone: phoneToSave,
          phone_ddi: phoneDdiToSave,
          label_template_ids:
            labelTemplateIds.length > 0 ? labelTemplateIds : undefined,
        },
        contactGroupId,
        accountId,
        false
      );

      if (!contactCreated) {
        return this.createStatusResult(
          contact,
          'invalid',
          t('contact_creation_failed')
        );
      }

      return this.createStatusResult(
        contact,
        'valid',
        t('contact_creator_success')
      );
    } catch (error) {
      const pgError = error as { code?: string; message?: string };
      if (pgError.code === '22001') {
        return this.createStatusResult(
          contact,
          'invalid',
          t('contact_field_too_long')
        );
      }
      return this.createStatusResult(
        contact,
        'invalid',
        (error as Error).message || t('contact_creation_failed')
      );
    }
  }

  async execute(
    t: TFunction<'translation', undefined>,
    input: CreateContactGroupAssignmentRequest,
    accountId: string,
    userId?: string,
    importSessionId?: string
  ): Promise<IContactImportStatus[]> {
    if (!input.contacts) return [];

    this.labelCache.clear();

    const contacts = await this.csvFileReaderService.read(input.contacts);

    if (!contacts.length) {
      throw new Error(t('no_contacts_found_in_file'));
    }

    const contactGroupId = input?.contact_group_id?.value || null;
    const results: IContactImportStatus[] = [];
    const total = contacts.length;

    const sendProgressUpdate = async (
      processed: number,
      lastContact: IContactImportStatus | null
    ) => {
      if (!this.centrifugoService || !importSessionId || !userId) return;

      const channel = `channels:user#${userId}:contact-import:${importSessionId}`;

      try {
        await this.centrifugoService.publish(channel, {
          processed,
          total,
          lastContact,
        });
      } catch (error) {
        console.error('Failed to send progress update:', error);
      }
    };

    for (let index = 0; index < contacts.length; index++) {
      const contact = contacts[index];
      const phone = contact?.phone;
      const phoneDdi = contact.phone_ddi ?? '55';

      if (!phone) {
        const result = this.createStatusResult(
          contact,
          'no_phone',
          t('phone_required_for_validation')
        );

        results.push(result);
        await sendProgressUpdate(index + 1, result);
        continue;
      }

      const validation = this.validateBrazilianPhone(t, phone, phoneDdi);

      if (!validation.isValid) {
        const result = this.createStatusResult(
          contact,
          'invalid',
          validation.message || t('invalid_phone_format')
        );

        results.push(result);
        await sendProgressUpdate(index + 1, result);
        continue;
      }

      const phones = buildCandidatesWithDdi(phone, phoneDdi);
      const phonesC = phones.map((phone) => this.encryptService.encrypt(phone));

      try {
        const result = await this.processContact(
          t,
          contact,
          phonesC,
          accountId,
          contactGroupId
        );

        results.push(result);

        await sendProgressUpdate(index + 1, result);
      } catch (error) {
        console.error(`Error processing contact at index ${index}:`, error);

        const errorResult = this.createStatusResult(
          contact,
          'invalid',
          (error as Error).message || t('contact_creation_failed')
        );

        results.push(errorResult);

        await sendProgressUpdate(index + 1, errorResult);
      }
    }

    if (this.centrifugoService && importSessionId && userId) {
      const channel = `channels:user#${userId}:contact-import:${importSessionId}`;
      try {
        await this.centrifugoService.publish(channel, {
          processed: total,
          total,
          completed: true,
          results,
        });
      } catch (error) {
        console.error('Failed to send completion update:', error);
      }
    }

    return results;
  }
}
