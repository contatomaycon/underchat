import { injectable } from 'tsyringe';
import { TFunction } from 'i18next';
import { AccountInfoCreatorUseCase } from '@core/useCases/account/AccountInfoCreator.useCase';
import { CreateAccountCustomizationRequest } from '@core/schema/accountSettings/createAccountCustomization/request.schema';
import { CreateAccountInfoRequest } from '@core/schema/account/createAccountInfo/request.schema';

@injectable()
export class AccountCustomizationCreatorUseCase {
  constructor(
    private readonly accountInfoCreatorUseCase: AccountInfoCreatorUseCase
  ) {}

  async execute(
    t: TFunction<'translation', undefined>,
    accountId: string | null | undefined,
    body: CreateAccountCustomizationRequest
  ): Promise<boolean> {
    if (!accountId) {
      throw new Error(t('account_not_found'));
    }

    const payload: CreateAccountInfoRequest = {
      ...body,
      account_id: { value: accountId },
    };

    return this.accountInfoCreatorUseCase.execute(t, payload);
  }
}
