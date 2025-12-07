import { injectable } from 'tsyringe';
import { TFunction } from 'i18next';
import { AccountService } from '@core/services/account.service';
import { ApiKeyService } from '@core/services/apiKey.service';
import { PlanAccountCancellationService } from '@core/services/planAccountCancellation.service';
import { EAccountStatus } from '@core/common/enums/EAccountStatus';

@injectable()
export class AccountDeleterUseCase {
  constructor(
    private readonly accountService: AccountService,
    private readonly apiKeyService: ApiKeyService,
    private readonly planAccountCancellationService: PlanAccountCancellationService
  ) {}

  async execute(
    t: TFunction<'translation', undefined>,
    accountId: string,
    isAdministrator: boolean
  ): Promise<boolean> {
    if (!isAdministrator) {
      throw new Error(t('is_not_administrator'));
    }

    const accountExists =
      await this.accountService.existsAccountById(accountId);

    if (!accountExists) {
      throw new Error(t('account_not_found'));
    }

    await this.cancelAccountPlanIfExists(t, accountId);

    const accountDeleted =
      await this.accountService.deleteAccountById(accountId);

    if (!accountDeleted) {
      throw new Error(t('account_deleter_error'));
    }

    const apiKeyDeleted = await this.apiKeyService.deleteApiKey(accountId);

    if (!apiKeyDeleted) {
      throw new Error(t('api_key_deleter_error'));
    }

    return true;
  }

  private async cancelAccountPlanIfExists(
    t: TFunction<'translation', undefined>,
    accountId: string
  ): Promise<void> {
    try {
      await this.planAccountCancellationService.cancelPlanAccount(
        t,
        accountId,
        EAccountStatus.inactive
      );
    } catch (error) {
      if (this.isPlanNotFoundError(error, t)) {
        return;
      }

      console.warn('Erro ao cancelar plano da conta:', error);
    }
  }

  private isPlanNotFoundError(
    error: unknown,
    t: TFunction<'translation', undefined>
  ): boolean {
    if (!(error instanceof Error)) {
      return false;
    }

    const planNotFoundMessage = t('plan_not_found_or_already_cancelled');
    return error.message === planNotFoundMessage;
  }
}
