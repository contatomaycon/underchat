import { injectable, inject } from 'tsyringe';
import { TFunction } from 'i18next';
import { ContactLabelTemplateRemoverUseCase } from '@core/useCases/contact/ContactLabelTemplateRemover.useCase';

@injectable()
export class ChatContactLabelTemplateRemoverUseCase {
  constructor(
    @inject(ContactLabelTemplateRemoverUseCase)
    private readonly contactLabelTemplateRemoverUseCase: ContactLabelTemplateRemoverUseCase
  ) {}

  async execute(
    t: TFunction<'translation', undefined>,
    accountId: string,
    contactId: string,
    labelTemplateId: string
  ): Promise<boolean> {
    return this.contactLabelTemplateRemoverUseCase.execute(
      t,
      accountId,
      contactId,
      labelTemplateId
    );
  }
}
