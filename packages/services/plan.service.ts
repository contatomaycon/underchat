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
import { SalesReportListerRepository } from '@core/repositories/plan/SalesReportLister.repository';
import { CreatePlanRequest } from '@core/schema/plan/createPlan/request.schema';
import { UpdatePlanRequest } from '@core/schema/plan/updatePlan/request.schema';
import { CreatePlanItemRequest } from '@core/schema/plan/createPlanItem/request.schema';
import { ListPlanItemResponse } from '@core/schema/plan/listPlanItems/response.schema';
import { ListPlanProductAllResponse } from '@core/schema/plan/listPlanProductAll/response.schema';
import { ListSalesReportRequest } from '@core/schema/plan/listSalesReport/request.schema';
import { SalesReportItem } from '@core/schema/plan/listSalesReport/response.schema';

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
    private readonly salesReportListerRepository: SalesReportListerRepository
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

  listSalesReport = async (
    perPage: number,
    currentPage: number,
    query: ListSalesReportRequest
  ): Promise<[SalesReportItem[], number]> => {
    const [result, total] = await Promise.all([
      this.salesReportListerRepository.listSalesReport(
        perPage,
        currentPage,
        query
      ),
      this.salesReportListerRepository.listSalesReportTotal(query),
    ]);

    return [result, total];
  };
}
