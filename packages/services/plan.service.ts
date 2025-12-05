import { injectable } from 'tsyringe';
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

@injectable()
export class PlanService {
  constructor(
    private readonly planListerRepository: PlanListerRepository,
    private readonly planAllListerRepository: PlanAllListerRepository,
    private readonly planCreatorRepository: PlanCreatorRepository,
    private readonly planUpdaterRepository: PlanUpdaterRepository,
    private readonly planDeleterTransactionRepository: PlanDeleterTransactionRepository,
    private readonly planItemCreatorRepository: PlanItemCreatorRepository,
    private readonly planItemDeleterRepository: PlanItemDeleterRepository,
    private readonly planItemsListerRepository: PlanItemsListerRepository,
    private readonly planProductAllListerRepository: PlanProductAllListerRepository,
    private readonly planSalesListerRepository: PlanSalesListerRepository,
    private readonly planWithItemsListerRepository: PlanWithItemsListerRepository,
    private readonly planProductWithPriceListerRepository: PlanProductWithPriceListerRepository,
    private readonly userCardsListerRepository: UserCardsListerRepository,
    private readonly userInfoViewerRepository: UserInfoViewerRepository,
    private readonly upgradeDiscountCalculatorRepository: UpgradeDiscountCalculatorRepository,
    private readonly paymentService: PaymentService,
    private readonly crossSellListerRepository: CrossSellListerRepository
  ) {}

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
  ): Promise<boolean> => {
    return this.planUpdaterRepository.updatePlan(planId, input);
  };

  deletePlan = async (t: any, planId: string): Promise<boolean> => {
    return this.planDeleterTransactionRepository.deletePlan(t, planId);
  };

  createPlanItem = async (
    input: CreatePlanItemRequest
  ): Promise<string | null> => {
    return this.planItemCreatorRepository.createPlanItem(input);
  };

  deletePlanItem = async (planItemId: string): Promise<boolean> => {
    return this.planItemDeleterRepository.deletePlanItemById(planItemId);
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

  listPlanWithItems = async (): Promise<ListPlanWithItemsResponse[]> => {
    return this.planWithItemsListerRepository.listPlanWithItems();
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
    newPlanId: string
  ): Promise<CalculateUpgradeDiscountResponse> => {
    return this.upgradeDiscountCalculatorRepository.calculateUpgradeDiscount(
      accountId,
      newPlanId
    );
  };

  getOrCreateCustomer = async (accountId: string) => {
    return this.paymentService.getOrCreateCustomer(accountId);
  };

  listAvailableCrossSells = async (): Promise<
    ListAvailableCrossSellResponse[]
  > => {
    return this.crossSellListerRepository.listAvailableCrossSells();
  };
}
