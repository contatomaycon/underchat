import { injectable } from 'tsyringe';
import { listPlan } from './methods/listPlan';
import { listPlanAll } from './methods/listPlanAll';
import { createPlan } from './methods/createPlan';
import { updatePlan } from './methods/updatePlan';
import { deletePlan } from './methods/deletePlan';
import { createPlanItem } from './methods/createPlanItem';
import { listPlanItems } from './methods/listPlanItems';
import { deletePlanItem } from './methods/deletePlanItem';
import { listPlanProductAll } from './methods/listPlanProductAll';
import { listSalesReport } from './methods/listSalesReport';

@injectable()
class PlanController {
  public listPlan = listPlan;
  public listPlanAll = listPlanAll;
  public createPlan = createPlan;
  public updatePlan = updatePlan;
  public deletePlan = deletePlan;
  public createPlanItem = createPlanItem;
  public listPlanItems = listPlanItems;
  public deletePlanItem = deletePlanItem;
  public listPlanProductAll = listPlanProductAll;
  public listSalesReport = listSalesReport;
}

export default PlanController;
