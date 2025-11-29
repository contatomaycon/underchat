import { injectable } from 'tsyringe';
import { TFunction } from 'i18next';
import { CreateChatContactRequest } from '@core/schema/chat/createContact/request.schema';
import { CreateContactRequest } from '@core/schema/contact/createContact/request.schema';
import { ContactCreatorUseCase } from '@core/useCases/contact/ContactCreator.useCase';

@injectable()
export class ChatContactCreatorUseCase {
  constructor(private readonly contactCreatorUseCase: ContactCreatorUseCase) {}

  async execute(
    t: TFunction<'translation', undefined>,
    input: CreateChatContactRequest,
    accountId: string
  ): Promise<boolean> {
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
    };

    const result = await this.contactCreatorUseCase.execute(
      t,
      contactRequest,
      accountId
    );

    return !!result;
  }
}
