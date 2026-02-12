import { injectable, inject } from 'tsyringe';
import { TFunction } from 'i18next';
import { AccountService } from '@core/services/account.service';
import { CreatePlanAccountExclusiveRequest } from '@core/schema/planAccountExclusive/createPlanAccountExclusive/request.schema';

@injectable()
export class PlanAccountExclusiveCreatorUseCase {
  constructor(
    @inject(AccountService)
    private readonly accountService: AccountService
  ) {}

  async execute(
    t: TFunction<'translation', undefined>,
    input: CreatePlanAccountExclusiveRequest
  ): Promise<string> {
    const accountExists = await this.accountService.existsAccountById(
      input.account_id
    );

    if (!accountExists) {
      throw new Error(t('account_not_found'));
    }

    const planAccountExclusiveId =
      await this.accountService.createPlanAccountExclusive(input);

    if (!planAccountExclusiveId) {
      throw new Error(t('plan_account_exclusive_creation_failed'));
    }

    return planAccountExclusiveId;
  }
}
