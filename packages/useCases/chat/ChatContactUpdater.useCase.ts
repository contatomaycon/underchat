import { injectable } from 'tsyringe';
import { TFunction } from 'i18next';
import { UpdateChatContactRequest } from '@core/schema/chat/updateContact/request.schema';
import { UpdateContactRequest } from '@core/schema/contact/editContact/request.schema';
import { ContactUpdaterUseCase } from '@core/useCases/contact/ContactUpdater.useCase';
import { normalizeContactRequest } from '@core/common/functions/normalizeContactRequest';
import { extractArrayFieldValue } from '@core/common/functions/extractArrayFieldValue';

@injectable()
export class ChatContactUpdaterUseCase {
  constructor(private readonly contactUpdaterUseCase: ContactUpdaterUseCase) {}

  async execute(
    t: TFunction<'translation', undefined>,
    accountId: string,
    contactId: string,
    body: UpdateChatContactRequest,
    allowedChannelIds: string[] = []
  ): Promise<boolean> {
    const normalizedBody = normalizeContactRequest(body);

    const labelTemplateIds = extractArrayFieldValue(
      normalizedBody.label_template_ids
    );
    const channelIds = extractArrayFieldValue(normalizedBody.channel_ids);

    const contactRequest: UpdateContactRequest = {
      label_template_ids: labelTemplateIds
        ? labelTemplateIds.map((id) => ({ value: id }))
        : undefined,
      channel_ids: channelIds.length > 0 ? channelIds : undefined,
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
      user_id: normalizedBody.user_id,
      ignore: normalizedBody.ignore,
    };

    const result = await this.contactUpdaterUseCase.execute(
      t,
      accountId,
      contactId,
      contactRequest,
      allowedChannelIds
    );

    return !!result;
  }
}
