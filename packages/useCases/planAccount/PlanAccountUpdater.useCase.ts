import { injectable, inject } from 'tsyringe';
import { TFunction } from 'i18next';
import { UpdatePlanAccountRequest } from '@core/schema/planAccount/updatePlanAccount/request.schema';
import { PlanAccountService } from '@core/services/planAccount.service';
import { AccountService } from '@core/services/account.service';

@injectable()
export class PlanAccountUpdaterUseCase {
  constructor(
    @inject(PlanAccountService)
    private readonly planAccountService: PlanAccountService,
    @inject(AccountService)
    private readonly accountService: AccountService
  ) {}

  async execute(
    t: TFunction<'translation', undefined>,
    accountId: string,
    body: UpdatePlanAccountRequest
  ): Promise<boolean> {
    const accountExists =
      await this.accountService.existsAccountById(accountId);

    if (!accountExists) {
      throw new Error(t('account_not_found'));
    }

    const updated = await this.planAccountService.updatePlanAccountByAccountId(
      accountId,
      body
    );

    if (!updated) {
      throw new Error(t('plan_account_update_error'));
    }

    return updated;
  }
}
