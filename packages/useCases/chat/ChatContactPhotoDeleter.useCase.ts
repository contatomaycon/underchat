import { injectable, inject } from 'tsyringe';
import { TFunction } from 'i18next';
import { ContactPhotoDeleterUseCase } from '@core/useCases/contact/ContactPhotoDeleter.useCase';

@injectable()
export class ChatContactPhotoDeleterUseCase {
  constructor(
    @inject(ContactPhotoDeleterUseCase)
    private readonly contactPhotoDeleterUseCase: ContactPhotoDeleterUseCase
  ) {}

  async execute(
    t: TFunction<'translation', undefined>,
    contactId: string,
    accountId: string
  ): Promise<boolean> {
    return this.contactPhotoDeleterUseCase.execute(t, contactId, accountId);
  }
}
