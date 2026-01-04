import { injectable } from 'tsyringe';
import { TFunction } from 'i18next';
import { UpdateChatContactRequest } from '@core/schema/chat/updateContact/request.schema';
import { UpdateContactRequest } from '@core/schema/contact/editContact/request.schema';
import { ContactUpdaterUseCase } from '@core/useCases/contact/ContactUpdater.useCase';
import { normalizeContactRequest } from '@core/common/functions/normalizeContactRequest';

@injectable()
export class ChatContactUpdaterUseCase {
  constructor(private readonly contactUpdaterUseCase: ContactUpdaterUseCase) {}

  async execute(
    t: TFunction<'translation', undefined>,
    accountId: string,
    contactId: string,
    body: UpdateChatContactRequest
  ): Promise<boolean> {
    const normalizedBody = normalizeContactRequest(body);

    const contactRequest: UpdateContactRequest = {
      label_template_id:
        normalizedBody.label_template_id === undefined
          ? null
          : normalizedBody.label_template_id,
      name: normalizedBody.name,
      last_name: normalizedBody.last_name,
      email: normalizedBody.email,
      phone_ddi: normalizedBody.phone_ddi,
      phone: normalizedBody.phone,
      nickname: normalizedBody.nickname,
      birthday: normalizedBody.birthday,
      notes: normalizedBody.notes,
      contact_document_type_id: normalizedBody.contact_document_type_id,
      document: normalizedBody.document,
      photo: normalizedBody.photo,
      image_url: normalizedBody.image_url,
    };

    const result = await this.contactUpdaterUseCase.execute(
      t,
      accountId,
      contactId,
      contactRequest
    );

    return !!result;
  }
}
