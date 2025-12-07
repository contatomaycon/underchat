import { injectable } from 'tsyringe';
import { TFunction } from 'i18next';
import { PlanAccountService } from '@core/services/planAccount.service';
import { AccountService } from '@core/services/account.service';
import { ViewPlanAccountResponse } from '@core/schema/planAccount/viewPlanAccount/response.schema';

@injectable()
export class PlanAccountViewerUseCase {
  constructor(
    private readonly planAccountService: PlanAccountService,
    private readonly accountService: AccountService
  ) {}

  async execute(
    t: TFunction<'translation', undefined>,
    accountId: string,
    isAdministrator: boolean
  ): Promise<ViewPlanAccountResponse | null> {
    if (!isAdministrator) {
      throw new Error(t('is_not_administrator'));
    }

    const accountExists =
      await this.accountService.existsAccountById(accountId);

    if (!accountExists) {
      throw new Error(t('account_not_found'));
    }

    const planAccount =
      await this.planAccountService.findPlanAccountByAccountId(accountId);

    if (!planAccount) {
      return null;
    }

    return {
      plan_account_id: planAccount.plan_account_id,
      plan_id: planAccount.plan_id,
      recurring_payment: planAccount.recurring_payment,
      billing_period_id: planAccount.billing_period_id,
      last_payment_date: planAccount.last_payment_date,
      next_payment_date: planAccount.next_payment_date,
      cancellation_date: planAccount.cancellation_date,
      value: planAccount.value,
    };
  }
}
