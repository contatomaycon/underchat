import { injectable, inject } from 'tsyringe';
import { ListCrossSellRequest } from '@core/schema/planCrossSell/listCrossSell/request.schema';
import { ListCrossSellResponse } from '@core/schema/planCrossSell/listCrossSell/response.schema';
import { CrossSellListerRepository } from '@core/repositories/planCrossSell/CrossSellLister.repository';
import { CrossSellCreatorRepository } from '@core/repositories/planCrossSell/CrossSellCreator.repository';
import { CrossSellUpdaterRepository } from '@core/repositories/planCrossSell/CrossSellUpdater.repository';
import { CrossSellDeleterTransactionRepository } from '@core/repositories/planCrossSell/CrossSellDeleterTransaction.repository';
import { CrossSellAccountCreatorRepository } from '@core/repositories/planCrossSell/CrossSellAccountCreator.repository';
import { CrossSellAccountListerRepository } from '@core/repositories/planCrossSell/CrossSellAccountLister.repository';
import { CrossSellAccountSingleDeleterRepository } from '@core/repositories/planCrossSell/CrossSellAccountSingleDeleter.repository';
import { CreateCrossSellRequest } from '@core/schema/planCrossSell/createCrossSell/request.schema';
import { UpdateCrossSellRequest } from '@core/schema/planCrossSell/updateCrossSell/request.schema';
import { CreateCrossSellAccountRequest } from '@core/schema/planCrossSell/createCrossSellAccount/request.schema';
import { ListCrossSellAccountResponse } from '@core/schema/planCrossSell/listCrossSellAccount/response.schema';
import { TFunction } from 'i18next';
import {
  type PlanEntitlementDenyFence,
  PlanEntitlementService,
} from './planEntitlement.service';
import { PlanEntitlementRepository } from '@core/repositories/planEntitlement/PlanEntitlement.repository';
import { EPlanProduct } from '@core/common/enums/EPlanProduct';

@injectable()
export class CrossSellService {
  constructor(
    @inject(CrossSellListerRepository)
    private readonly crossSellListerRepository: CrossSellListerRepository,
    @inject(CrossSellCreatorRepository)
    private readonly crossSellCreatorRepository: CrossSellCreatorRepository,
    @inject(CrossSellUpdaterRepository)
    private readonly crossSellUpdaterRepository: CrossSellUpdaterRepository,
    @inject(CrossSellDeleterTransactionRepository)
    private readonly crossSellDeleterTransactionRepository: CrossSellDeleterTransactionRepository,
    @inject(CrossSellAccountCreatorRepository)
    private readonly crossSellAccountCreatorRepository: CrossSellAccountCreatorRepository,
    @inject(CrossSellAccountListerRepository)
    private readonly crossSellAccountListerRepository: CrossSellAccountListerRepository,
    @inject(CrossSellAccountSingleDeleterRepository)
    private readonly crossSellAccountSingleDeleterRepository: CrossSellAccountSingleDeleterRepository,
    @inject(PlanEntitlementRepository)
    private readonly planEntitlementRepository: PlanEntitlementRepository,
    @inject(PlanEntitlementService)
    private readonly planEntitlementService: PlanEntitlementService
  ) {}

  private readonly restoreCrossSellEntitlementAfterFailure = async (
    crossSellId: string,
    previousPlanProductId?: string,
    denyFences: readonly PlanEntitlementDenyFence[] = []
  ): Promise<void> => {
    try {
      await (denyFences.length
        ? this.planEntitlementService.refreshAccountsForCrossSell(
            crossSellId,
            previousPlanProductId,
            denyFences
          )
        : this.planEntitlementService.refreshAccountsForCrossSell(
            crossSellId,
            previousPlanProductId
          ));
    } catch (error) {
      console.error(
        'Could not restore plan entitlement after a failed cross-sell mutation.',
        error
      );
    }
  };

  private readonly restoreCrossSellAccountEntitlementAfterFailure = async (
    crossSellAccountId: string,
    denyFenceOwnerToken?: string
  ): Promise<void> => {
    try {
      await (denyFenceOwnerToken
        ? this.planEntitlementService.refreshCrossSellAccount(
            crossSellAccountId,
            denyFenceOwnerToken
          )
        : this.planEntitlementService.refreshCrossSellAccount(
            crossSellAccountId
          ));
    } catch (error) {
      console.error(
        'Could not restore plan entitlement after a failed cross-sell account mutation.',
        error
      );
    }
  };

  listCrossSells = async (
    perPage: number,
    currentPage: number,
    query: ListCrossSellRequest
  ): Promise<[ListCrossSellResponse[], number]> => {
    const [result, total] = await Promise.all([
      this.crossSellListerRepository.listCrossSells(
        perPage,
        currentPage,
        query
      ),
      this.crossSellListerRepository.listCrossSellsTotal(query),
    ]);

    return [result, total];
  };

  createCrossSell = async (
    input: CreateCrossSellRequest
  ): Promise<string | null> => {
    return this.crossSellCreatorRepository.createCrossSell(input);
  };

  updateCrossSell = async (
    crossSellId: string,
    input: UpdateCrossSellRequest
  ): Promise<boolean> => {
    const previousContext =
      await this.planEntitlementRepository.findCrossSellContext(crossSellId);
    const previousPlanProductId = previousContext?.planProductId;
    const changesIntegrationProduct =
      (input.plan_product_id !== undefined &&
        (input.plan_product_id === EPlanProduct.integration ||
          previousPlanProductId === EPlanProduct.integration)) ||
      (input.quantity !== undefined &&
        previousPlanProductId === EPlanProduct.integration);
    const revokesIntegrationProduct =
      previousPlanProductId === EPlanProduct.integration &&
      ((input.plan_product_id !== undefined &&
        input.plan_product_id !== EPlanProduct.integration) ||
        (input.quantity !== undefined && input.quantity <= 0));

    if (!changesIntegrationProduct) {
      return this.crossSellUpdaterRepository.updateCrossSell(
        crossSellId,
        input
      );
    }

    const refresh = (denyFences: readonly PlanEntitlementDenyFence[] = []) =>
      denyFences.length
        ? this.planEntitlementService.refreshAccountsForCrossSell(
            crossSellId,
            previousPlanProductId,
            denyFences
          )
        : this.planEntitlementService.refreshAccountsForCrossSell(
            crossSellId,
            previousPlanProductId
          );

    if (!revokesIntegrationProduct) {
      await this.planEntitlementService.refreshAccounts(
        previousContext?.accountIds ?? [],
        EPlanProduct.integration
      );
      const updated = await this.crossSellUpdaterRepository.updateCrossSell(
        crossSellId,
        input
      );

      if (updated) {
        await refresh();
      }

      return updated;
    }

    let denyFences: PlanEntitlementDenyFence[];
    try {
      denyFences =
        await this.planEntitlementService.installDenyFencesForCrossSell(
          crossSellId,
          previousPlanProductId
        );
    } catch (error) {
      throw error;
    }

    let mutationCompleted = false;

    try {
      const updated = await this.crossSellUpdaterRepository.updateCrossSell(
        crossSellId,
        input
      );
      mutationCompleted = true;
      await refresh(denyFences);
      return updated;
    } catch (error) {
      if (!mutationCompleted) {
        await this.restoreCrossSellEntitlementAfterFailure(
          crossSellId,
          previousPlanProductId,
          denyFences
        );
      }
      throw error;
    }
  };

  deleteCrossSell = async (
    t: TFunction<'translation', undefined>,
    crossSellId: string
  ): Promise<boolean> => {
    const context =
      await this.planEntitlementRepository.findCrossSellContext(crossSellId);

    if (context?.planProductId !== EPlanProduct.integration) {
      return this.crossSellDeleterTransactionRepository.deleteCrossSell(
        t,
        crossSellId
      );
    }

    let denyFences: PlanEntitlementDenyFence[];
    try {
      denyFences =
        await this.planEntitlementService.installDenyFencesForCrossSell(
          crossSellId,
          context.planProductId
        );
    } catch (error) {
      throw error;
    }

    let mutationCompleted = false;

    try {
      const deleted =
        await this.crossSellDeleterTransactionRepository.deleteCrossSell(
          t,
          crossSellId
        );
      mutationCompleted = true;
      await this.planEntitlementService.refreshAccountsForCrossSell(
        crossSellId,
        context.planProductId,
        denyFences
      );
      return deleted;
    } catch (error) {
      if (!mutationCompleted) {
        await this.restoreCrossSellEntitlementAfterFailure(
          crossSellId,
          context.planProductId,
          denyFences
        );
      }
      throw error;
    }
  };

  createCrossSellAccount = async (
    input: CreateCrossSellAccountRequest
  ): Promise<string | null> => {
    const context = await this.planEntitlementRepository.findCrossSellContext(
      input.plan_cross_sell_id
    );

    if (context?.planProductId === EPlanProduct.integration) {
      await this.planEntitlementService.refreshAfterMutation(
        input.account_id,
        EPlanProduct.integration
      );
    }

    const crossSellAccountId =
      await this.crossSellAccountCreatorRepository.createCrossSellAccount(
        input
      );

    if (
      crossSellAccountId &&
      context?.planProductId === EPlanProduct.integration
    ) {
      await this.planEntitlementService.refreshCrossSellAccount(
        crossSellAccountId
      );
    }

    return crossSellAccountId;
  };

  listCrossSellAccounts = async (
    crossSellId: string
  ): Promise<ListCrossSellAccountResponse[]> => {
    return this.crossSellAccountListerRepository.listCrossSellAccounts(
      crossSellId
    );
  };

  deleteCrossSellAccount = async (
    crossSellAccountId: string
  ): Promise<boolean> => {
    const context =
      await this.planEntitlementRepository.findCrossSellAccountContext(
        crossSellAccountId
      );

    if (context?.planProductId !== EPlanProduct.integration) {
      return this.crossSellAccountSingleDeleterRepository.deleteCrossSellAccountById(
        crossSellAccountId
      );
    }

    let denyFenceOwnerToken: string | null;
    try {
      denyFenceOwnerToken =
        await this.planEntitlementService.installDenyFenceForCrossSellAccount(
          crossSellAccountId
        );
    } catch (error) {
      throw error;
    }

    let mutationCompleted = false;

    try {
      const deleted =
        await this.crossSellAccountSingleDeleterRepository.deleteCrossSellAccountById(
          crossSellAccountId
        );
      mutationCompleted = true;
      if (denyFenceOwnerToken) {
        await this.planEntitlementService.refreshCrossSellAccount(
          crossSellAccountId,
          denyFenceOwnerToken
        );
      } else {
        await this.planEntitlementService.refreshCrossSellAccount(
          crossSellAccountId
        );
      }
      return deleted;
    } catch (error) {
      if (!mutationCompleted) {
        await this.restoreCrossSellAccountEntitlementAfterFailure(
          crossSellAccountId,
          denyFenceOwnerToken ?? undefined
        );
      }
      throw error;
    }
  };
}
