import { injectable } from 'tsyringe';
import { TFunction } from 'i18next';
import { CreateChatContactRequest } from '@core/schema/chat/createContact/request.schema';
import { CreateContactRequest } from '@core/schema/contact/createContact/request.schema';
import { ContactCreatorUseCase } from '@core/useCases/contact/ContactCreator.useCase';
import { normalizeContactRequest } from '@core/common/functions/normalizeContactRequest';

@injectable()
export class ChatContactCreatorUseCase {
  constructor(private readonly contactCreatorUseCase: ContactCreatorUseCase) {}

  private extractChatId(
    chatId: CreateChatContactRequest['chat_id']
  ): string | null {
    if (!chatId) {
      return null;
    }

    if (typeof chatId === 'object' && 'value' in chatId) {
      return chatId.value ?? null;
    }

    return typeof chatId === 'string' ? chatId : null;
  }

  async execute(
    t: TFunction<'translation', undefined>,
    input: CreateChatContactRequest,
    accountId: string
  ): Promise<boolean> {
    const normalizedInput = normalizeContactRequest(input);
    const chatId = this.extractChatId(normalizedInput.chat_id);

    const contactRequest: CreateContactRequest = {
      label_template_ids: normalizedInput.label_template_ids,
      name: normalizedInput.name,
      last_name: normalizedInput.last_name,
      email: normalizedInput.email,
      phone_ddi: normalizedInput.phone_ddi,
      phone: normalizedInput.phone,
      nickname: normalizedInput.nickname,
      birthday: normalizedInput.birthday,
      notes: normalizedInput.notes,
      contact_document_type_id: normalizedInput.contact_document_type_id,
      document: normalizedInput.document,
      photo: normalizedInput.photo,
      image_url: normalizedInput.image_url,
      chat_id: chatId,
      user_id: normalizedInput.user_id,
      ignore: normalizedInput.ignore,
    };

    const result = await this.contactCreatorUseCase.execute(
      t,
      contactRequest,
      accountId
    );

    return !!result;
  }
}
