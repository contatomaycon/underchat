import { injectable, inject } from 'tsyringe';
import { TFunction } from 'i18next';
import { ListPlanRequest } from '@core/schema/plan/listPlan/request.schema';
import { ListPlanResponse } from '@core/schema/plan/listPlan/response.schema';
import { PlanListerRepository } from '@core/repositories/plan/PlanLister.repository';
import { PlanAllListerRepository } from '@core/repositories/plan/PlanAllLister.repository';
import { ListPlanAllResponse } from '@core/schema/plan/listPlanAll/response.schema';
import { PlanCreatorRepository } from '@core/repositories/plan/PlanCreator.repository';
import { PlanUpdaterRepository } from '@core/repositories/plan/PlanUpdater.repository';
import { PlanDeleterTransactionRepository } from '@core/repositories/plan/PlanDeleterTransaction.repository';
import { PlanItemCreatorRepository } from '@core/repositories/plan/PlanItemCreator.repository';
import { PlanItemDeleterRepository } from '@core/repositories/plan/PlanItemDeleter.repository';
import { PlanItemsListerRepository } from '@core/repositories/plan/PlanItemsLister.repository';
import { PlanProductAllListerRepository } from '@core/repositories/plan/PlanProductAllLister.repository';
import { PlanSalesListerRepository } from '@core/repositories/plan/PlanSalesLister.repository';
import { PlanWithItemsListerRepository } from '@core/repositories/plan/PlanWithItemsLister.repository';
import { CreatePlanRequest } from '@core/schema/plan/createPlan/request.schema';
import { UpdatePlanRequest } from '@core/schema/plan/updatePlan/request.schema';
import { CreatePlanItemRequest } from '@core/schema/plan/createPlanItem/request.schema';
import { ListPlanItemResponse } from '@core/schema/plan/listPlanItems/response.schema';
import { ListPlanProductAllResponse } from '@core/schema/plan/listPlanProductAll/response.schema';
import { ListPlanSalesRequest } from '@core/schema/plan/listPlanSales/request.schema';
import { ListPlanSalesResponse } from '@core/schema/plan/listPlanSales/response.schema';
import { ListPlanSalesSummaryResponse } from '@core/schema/plan/listPlanSalesSummary/response.schema';
import { ListPlanWithItemsResponse } from '@core/schema/plan/listPlanWithItems/response.schema';
import { ListPlanProductWithPriceResponse } from '@core/schema/plan/listPlanProductWithPrice/response.schema';
import { PlanProductWithPriceListerRepository } from '@core/repositories/plan/PlanProductWithPriceLister.repository';
import { ListUserCardResponse } from '@core/schema/plan/listUserCards/response.schema';
import { UserCardsListerRepository } from '@core/repositories/plan/UserCardsLister.repository';
import { ViewUserInfoResponse } from '@core/schema/plan/viewUserInfo/response.schema';
import { UserInfoViewerRepository } from '@core/repositories/plan/UserInfoViewer.repository';
import { CalculateUpgradeDiscountResponse } from '@core/schema/plan/calculateUpgradeDiscount/response.schema';
import { UpgradeDiscountCalculatorRepository } from '@core/repositories/plan/UpgradeDiscountCalculator.repository';
import { PaymentService } from './payment.service';
import { CrossSellListerRepository } from '@core/repositories/planCrossSell/CrossSellLister.repository';
import { ListAvailableCrossSellResponse } from '@core/schema/plan/listAvailableCrossSell/response.schema';
import {
  OrderPaymentCreatorRepository,
  type ICreateAccountPaymentInput,
  type ICreateAccountPaymentCrossSellsInput,
} from '@core/repositories/plan/OrderPaymentCreator.repository';
import { CreateOrderPaymentRequest } from '@core/schema/plan/createOrderPayment/request.schema';
import {
  PlanEntitlementDenyFence,
  PlanEntitlementService,
} from './planEntitlement.service';
import { EPlanProduct } from '@core/common/enums/EPlanProduct';
import { PlanEntitlementRepository } from '@core/repositories/planEntitlement/PlanEntitlement.repository';

@injectable()
export class PlanService {
  constructor(
    @inject(PlanListerRepository)
    private readonly planListerRepository: PlanListerRepository,
    @inject(PlanAllListerRepository)
    private readonly planAllListerRepository: PlanAllListerRepository,
    @inject(PlanCreatorRepository)
    private readonly planCreatorRepository: PlanCreatorRepository,
    @inject(PlanUpdaterRepository)
    private readonly planUpdaterRepository: PlanUpdaterRepository,
    @inject(PlanDeleterTransactionRepository)
    private readonly planDeleterTransactionRepository: PlanDeleterTransactionRepository,
    @inject(PlanItemCreatorRepository)
    private readonly planItemCreatorRepository: PlanItemCreatorRepository,
    @inject(PlanItemDeleterRepository)
    private readonly planItemDeleterRepository: PlanItemDeleterRepository,
    @inject(PlanItemsListerRepository)
    private readonly planItemsListerRepository: PlanItemsListerRepository,
    @inject(PlanProductAllListerRepository)
    private readonly planProductAllListerRepository: PlanProductAllListerRepository,
    @inject(PlanSalesListerRepository)
    private readonly planSalesListerRepository: PlanSalesListerRepository,
    @inject(PlanWithItemsListerRepository)
    private readonly planWithItemsListerRepository: PlanWithItemsListerRepository,
    @inject(PlanProductWithPriceListerRepository)
    private readonly planProductWithPriceListerRepository: PlanProductWithPriceListerRepository,
    @inject(UserCardsListerRepository)
    private readonly userCardsListerRepository: UserCardsListerRepository,
    @inject(UserInfoViewerRepository)
    private readonly userInfoViewerRepository: UserInfoViewerRepository,
    @inject(UpgradeDiscountCalculatorRepository)
    private readonly upgradeDiscountCalculatorRepository: UpgradeDiscountCalculatorRepository,
    @inject(PaymentService)
    private readonly paymentService: PaymentService,
    @inject(CrossSellListerRepository)
    private readonly crossSellListerRepository: CrossSellListerRepository,
    @inject(OrderPaymentCreatorRepository)
    private readonly orderPaymentCreatorRepository: OrderPaymentCreatorRepository,
    @inject(PlanEntitlementRepository)
    private readonly planEntitlementRepository: PlanEntitlementRepository,
    @inject(PlanEntitlementService)
    private readonly planEntitlementService: PlanEntitlementService
  ) {}

  private readonly restorePlanEntitlementAfterFailure = async (
    refresh: () => Promise<unknown>
  ): Promise<void> => {
    try {
      await refresh();
    } catch (error) {
      console.error(
        'Could not restore plan entitlement after a failed mutation.',
        error
      );
    }
  };

  private readonly runWithDenyFence = async <T>(input: {
    installFence: () => Promise<PlanEntitlementDenyFence[]>;
    mutate: () => Promise<T>;
    refresh: (fences?: readonly PlanEntitlementDenyFence[]) => Promise<unknown>;
  }): Promise<T> => {
    let fences: PlanEntitlementDenyFence[];
    try {
      fences = await input.installFence();
    } catch (error) {
      throw error;
    }

    let mutationCompleted = false;

    try {
      const result = await input.mutate();
      mutationCompleted = true;
      await input.refresh(fences);
      return result;
    } catch (error) {
      if (!mutationCompleted) {
        await this.restorePlanEntitlementAfterFailure(() =>
          input.refresh(fences)
        );
      }
      throw error;
    }
  };

  listPlans = async (
    perPage: number,
    currentPage: number,
    query: ListPlanRequest
  ): Promise<[ListPlanResponse[], number]> => {
    const [result, total] = await Promise.all([
      this.planListerRepository.listPlans(perPage, currentPage, query),
      this.planListerRepository.listPlansTotal(query),
    ]);

    return [result, total];
  };

  listPlanAll = async (): Promise<ListPlanAllResponse[]> => {
    return this.planAllListerRepository.listPlanAll();
  };

  createPlan = async (input: CreatePlanRequest): Promise<string | null> => {
    return this.planCreatorRepository.createPlan(input);
  };

  updatePlan = async (
    planId: string,
    input: UpdatePlanRequest
  ): Promise<boolean> => this.planUpdaterRepository.updatePlan(planId, input);

  deletePlan = async (t: any, planId: string): Promise<boolean> => {
    return this.runWithDenyFence({
      installFence: () =>
        this.planEntitlementService.installDenyFencesForPlan(
          planId,
          EPlanProduct.integration
        ),
      mutate: () => this.planDeleterTransactionRepository.deletePlan(t, planId),
      refresh: (fences) =>
        fences?.length
          ? this.planEntitlementService.refreshAccountsForPlan(
              planId,
              EPlanProduct.integration,
              fences
            )
          : this.planEntitlementService.refreshAccountsForPlan(
              planId,
              EPlanProduct.integration
            ),
    });
  };

  createPlanItem = async (
    input: CreatePlanItemRequest
  ): Promise<string | null> => {
    const isIntegration = input.plan_product_id === EPlanProduct.integration;

    if (isIntegration) {
      await this.planEntitlementService.refreshAccountsForPlan(
        input.plan_id,
        EPlanProduct.integration
      );
    }

    const planItemId =
      await this.planItemCreatorRepository.createPlanItem(input);

    if (planItemId && isIntegration) {
      await this.planEntitlementService.refreshAccountsForPlanItem(planItemId);
    }

    return planItemId;
  };

  deletePlanItem = async (planItemId: string): Promise<boolean> => {
    const context =
      await this.planEntitlementRepository.findPlanItemContext(planItemId);

    if (context?.plan_product_id !== EPlanProduct.integration) {
      return this.planItemDeleterRepository.deletePlanItemById(planItemId);
    }

    return this.runWithDenyFence({
      installFence: () =>
        this.planEntitlementService.installDenyFencesForPlanItem(planItemId),
      mutate: () =>
        this.planItemDeleterRepository.deletePlanItemById(planItemId),
      refresh: (fences) =>
        fences?.length
          ? this.planEntitlementService.refreshAccountsForPlanItem(
              planItemId,
              fences
            )
          : this.planEntitlementService.refreshAccountsForPlanItem(planItemId),
    });
  };

  listPlanItems = async (planId: string): Promise<ListPlanItemResponse[]> => {
    return this.planItemsListerRepository.listPlanItems(planId);
  };

  listPlanProductAll = async (): Promise<ListPlanProductAllResponse[]> => {
    return this.planProductAllListerRepository.listPlanProductAll();
  };

  listPlanProductWithPrice = async (): Promise<
    ListPlanProductWithPriceResponse[]
  > => {
    return this.planProductWithPriceListerRepository.listPlanProductWithPrice();
  };

  listPlanSales = async (
    query: ListPlanSalesRequest
  ): Promise<ListPlanSalesResponse[]> => {
    return this.planSalesListerRepository.listPlanSales(query);
  };

  listPlanSalesSummary = async (
    query: ListPlanSalesRequest
  ): Promise<ListPlanSalesSummaryResponse> => {
    return this.planSalesListerRepository.listPlanSalesSummary(query);
  };

  listPlanWithItems = async (
    accountId: string | null
  ): Promise<ListPlanWithItemsResponse[]> => {
    return this.planWithItemsListerRepository.listPlanWithItems(accountId);
  };

  listUserCards = async (userId: string): Promise<ListUserCardResponse[]> => {
    return this.userCardsListerRepository.listUserCards(userId);
  };

  viewUserInfo = async (
    userId: string
  ): Promise<ViewUserInfoResponse | null> => {
    return this.userInfoViewerRepository.viewUserInfo(userId);
  };

  calculateUpgradeDiscount = async (
    accountId: string,
    newPlanId: string,
    billingPeriod?: 'monthly' | 'annual'
  ): Promise<CalculateUpgradeDiscountResponse> => {
    return this.upgradeDiscountCalculatorRepository.calculateUpgradeDiscount(
      accountId,
      newPlanId,
      billingPeriod
    );
  };

  getOrCreateCustomer = async (
    t: TFunction<'translation', undefined>,
    accountId: string
  ) => {
    return this.paymentService.getOrCreateCustomer(t, accountId);
  };

  listAvailableCrossSells = async (input?: {
    accountId?: string;
    pricingMode?: 'full' | 'proportional';
  }): Promise<ListAvailableCrossSellResponse[]> => {
    return this.crossSellListerRepository.listAvailableCrossSells({
      accountId: input?.accountId,
      pricingMode: input?.pricingMode,
    });
  };

  calculateOrderPayment = async (
    accountId: string,
    input: CreateOrderPaymentRequest
  ): Promise<{
    planPrice: number;
    addonsTotal: number;
    discountAmount: number;
    totalAmount: number;
  }> => {
    return this.orderPaymentCreatorRepository.calculateOrderPayment(
      accountId,
      input
    );
  };

  getBillingPeriodId = (billingPeriod: 'monthly' | 'annual'): string | null => {
    return this.orderPaymentCreatorRepository.getBillingPeriodId(billingPeriod);
  };

  createAccountPayment = async (data: {
    accountId: string;
    userCustomerId: string;
    planId: string;
    billing: string;
    paymentBillingTypeId: string;
    value: string;
    netValue: string;
    pixTransaction: string | null;
    paymentStatusId: string;
    billingPeriodId: string | null;
    invoiceUrl: string | null;
    recurringPayment: boolean;
    isAddonOnly: boolean;
    userCardId?: string | null;
    installment?: string | null;
    boleto?: string | null;
    boletoNumber?: string | null;
    boletoPdf?: string | null;
  }): Promise<string> => {
    return this.orderPaymentCreatorRepository.createAccountPayment(data);
  };

  createAccountPaymentCrossSells = async (data: {
    accountPaymentId: string;
    addons: Array<{ plan_cross_sell_id: string; value?: number }>;
    billingPeriod: 'monthly' | 'annual';
  }): Promise<void> => {
    return this.orderPaymentCreatorRepository.createAccountPaymentCrossSells(
      data
    );
  };

  createAccountPaymentWithCrossSells = async (data: {
    payment: ICreateAccountPaymentInput;
    addons: ICreateAccountPaymentCrossSellsInput['addons'];
    billingPeriod: ICreateAccountPaymentCrossSellsInput['billingPeriod'];
  }): Promise<string> => {
    return this.orderPaymentCreatorRepository.createAccountPaymentWithCrossSells(
      data
    );
  };

  getPlan = async (
    planId: string
  ): Promise<{
    plan_id: string;
    price: string;
    annual_discount: string | null;
    is_test: boolean;
    days_trial: number | null;
  } | null> => {
    const plan = await this.orderPaymentCreatorRepository.getPlan(planId);
    return plan || null;
  };

  getCurrentActivePlanAccount = async (accountId: string) => {
    return this.orderPaymentCreatorRepository.getCurrentActivePlanAccount(
      accountId
    );
  };
}
