import { injectable } from 'tsyringe';
import { TFunction } from 'i18next';
import { UpdateChatContactRequest } from '@core/schema/chat/updateContact/request.schema';
import { UpdateContactRequest } from '@core/schema/contact/editContact/request.schema';
import { ContactUpdaterUseCase } from '@core/useCases/contact/ContactUpdater.useCase';

@injectable()
export class ChatContactUpdaterUseCase {
  constructor(private readonly contactUpdaterUseCase: ContactUpdaterUseCase) {}

  async execute(
    t: TFunction<'translation', undefined>,
    accountId: string,
    contactId: string,
    body: UpdateChatContactRequest
  ): Promise<boolean> {
    const contactRequest: UpdateContactRequest = {
      label_template_id:
        body.label_template_id === undefined ? null : body.label_template_id,
      name: body.name,
      last_name: body.last_name,
      email: body.email,
      phone_ddi: body.phone_ddi,
      phone: body.phone,
      nickname: body.nickname,
      birthday: body.birthday,
      notes: body.notes,
      photo: body.photo,
      image_url: body.image_url,
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
