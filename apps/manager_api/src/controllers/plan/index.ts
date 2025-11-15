import { injectable } from 'tsyringe';
import { listPlan } from './methods/listPlan';
import { listPlanAll } from './methods/listPlanAll';

@injectable()
class PlanController {
  public listPlan = listPlan;
  public listPlanAll = listPlanAll;
}

export default PlanController;
