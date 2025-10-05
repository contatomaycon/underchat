import { injectable } from 'tsyringe';
import { listPlan } from './methods/listPlan';

@injectable()
class PlanController {
  public listPlan = listPlan;
}

export default PlanController;
