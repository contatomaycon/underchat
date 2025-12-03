import { injectable } from 'tsyringe';
import { TFunction } from 'i18next';
import { CreateChatContactRequest } from '@core/schema/chat/createContact/request.schema';
import { CreateContactRequest } from '@core/schema/contact/createContact/request.schema';
import { ContactCreatorUseCase } from '@core/useCases/contact/ContactCreator.useCase';

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
    const chatId = this.extractChatId(input.chat_id);

    const contactRequest: CreateContactRequest = {
      label_template_id: input.label_template_id,
      name: input.name,
      last_name: input.last_name,
      email: input.email,
      phone_ddi: input.phone_ddi,
      phone: input.phone,
      nickname: input.nickname,
      birthday: input.birthday,
      notes: input.notes,
      photo: input.photo,
      image_url: input.image_url,
      chat_id: chatId,
    };

    const result = await this.contactCreatorUseCase.execute(
      t,
      contactRequest,
      accountId
    );

    return !!result;
  }
}
