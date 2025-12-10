import { injectable } from 'tsyringe';
import { TFunction } from 'i18next';
import { ContactValidatorUseCase } from '@core/useCases/contact/ContactValidator.useCase';

@injectable()
export class ChatContactValidatorUseCase {
  constructor(
    private readonly contactValidatorUseCase: ContactValidatorUseCase
  ) {}

  async execute(
    t: TFunction<'translation', undefined>,
    contactId: string,
    accountId: string
  ): Promise<boolean> {
    return this.contactValidatorUseCase.execute(t, contactId, accountId);
  }
}
