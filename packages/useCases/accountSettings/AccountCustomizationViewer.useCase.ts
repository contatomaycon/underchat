import { injectable } from 'tsyringe';
import { TFunction } from 'i18next';
import { AccountService } from '@core/services/account.service';
import { PlanAccountService } from '@core/services/planAccount.service';
import { ViewAccountCustomizationResponse } from '@core/schema/accountSettings/viewAccountCustomization/response.schema';

@injectable()
export class AccountCustomizationViewerUseCase {
  constructor(
    private readonly accountService: AccountService,
    private readonly planAccountService: PlanAccountService
  ) {}

  async execute(
    t: TFunction<'translation', undefined>,
    accountId: string
  ): Promise<ViewAccountCustomizationResponse | null> {
    const accountInfoExists =
      await this.accountService.existsAccountInfoById(accountId);

    if (!accountInfoExists) {
      throw new Error(t('account_info_not_found'));
    }

    const accountInfo =
      await this.accountService.viewAccountInfoByAccountId(accountId);

    if (!accountInfo) {
      return null;
    }

    const canEdit =
      await this.planAccountService.validateCanCreatePersonalization(accountId);

    return {
      ...accountInfo,
      can_edit: canEdit,
    };
  }
}
