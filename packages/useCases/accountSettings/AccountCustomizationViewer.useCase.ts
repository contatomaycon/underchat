import { injectable } from 'tsyringe';
import { TFunction } from 'i18next';
import { AccountInfoViewerUseCase } from '@core/useCases/account/AccountInfoViewer.useCase';
import { ViewAccountInfoResponse } from '@core/schema/account/viewAccountInfo/response.schema';

@injectable()
export class AccountCustomizationViewerUseCase {
  constructor(
    private readonly accountInfoViewerUseCase: AccountInfoViewerUseCase
  ) {}

  async execute(
    t: TFunction<'translation', undefined>,
    accountId: string | null | undefined
  ): Promise<ViewAccountInfoResponse | null> {
    if (!accountId) {
      throw new Error(t('account_not_found'));
    }

    return this.accountInfoViewerUseCase.execute(t, accountId);
  }
}
