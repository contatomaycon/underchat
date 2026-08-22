import { injectable, inject } from 'tsyringe';
import { TFunction } from 'i18next';
import { currentTime } from '@core/common/functions/currentTime';
import { AccountAddonCancellerRepository } from '@core/repositories/accountSettings/AccountAddonCanceller.repository';
import { CancelAccountAddonResponse } from '@core/schema/accountSettings/cancelAccountAddon/response.schema';
import { PlanEntitlementService } from '@core/services/planEntitlement.service';
import { EPlanProduct } from '@core/common/enums/EPlanProduct';

@injectable()
export class AccountAddonCancellerUseCase {
  constructor(
    @inject(AccountAddonCancellerRepository)
    private readonly accountAddonCancellerRepository: AccountAddonCancellerRepository,
    @inject(PlanEntitlementService)
    private readonly planEntitlementService: PlanEntitlementService
  ) {}

  execute = async (
    t: TFunction<'translation', undefined>,
    accountId: string,
    planCrossSellAccountId: string
  ): Promise<CancelAccountAddonResponse> => {
    const addon = await this.accountAddonCancellerRepository.findAddonById(
      accountId,
      planCrossSellAccountId
    );

    if (!addon || addon.cancellation_date) {
      throw new Error(t('addon_not_found_or_already_cancelled'));
    }

    const hasActiveCycle =
      await this.accountAddonCancellerRepository.hasActivePlanCycle(accountId);

    if (!hasActiveCycle) {
      throw new Error(t('addon_cancel_requires_active_cycle'));
    }

    const requiresIntegrationEntitlement =
      addon.plan_product_id === EPlanProduct.integration;
    const denyFenceOwnerToken = requiresIntegrationEntitlement
      ? await this.planEntitlementService.installDenyFenceForCrossSellAccount(
          planCrossSellAccountId
        )
      : null;
    let mutationCompleted = false;

    try {
      const cancelled =
        await this.accountAddonCancellerRepository.scheduleAddonCancellation({
          accountId,
          planCrossSellAccountId,
          cancellationDate: currentTime(),
        });

      if (!cancelled) {
        throw new Error(t('addon_cancel_failed'));
      }
      mutationCompleted = true;

      if (requiresIntegrationEntitlement && denyFenceOwnerToken) {
        await this.planEntitlementService.refreshCrossSellAccount(
          planCrossSellAccountId,
          denyFenceOwnerToken
        );
      }
    } catch (error) {
      if (
        requiresIntegrationEntitlement &&
        !mutationCompleted &&
        denyFenceOwnerToken
      ) {
        await this.planEntitlementService.refreshCrossSellAccount(
          planCrossSellAccountId,
          denyFenceOwnerToken
        );
      }
      throw error;
    }

    return {
      success: true,
      message: t('addon_cancelled_successfully'),
    };
  };
}
