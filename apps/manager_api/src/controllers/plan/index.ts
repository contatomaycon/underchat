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
import { listPlanProductWithPrice } from './methods/listPlanProductWithPrice';
import { listUserCards } from './methods/listUserCards';
import { viewUserInfo } from './methods/viewUserInfo';
import { listPlanSales } from './methods/listPlanSales';
import { listPlanSalesSummary } from './methods/listPlanSalesSummary';
import { listPlanWithItems } from './methods/listPlanWithItems';
import { viewCurrentPlan } from './methods/viewCurrentPlan';
import { calculateUpgradeDiscount } from './methods/calculateUpgradeDiscount';
import { createOrderPayment } from './methods/createOrderPayment';
import { listAvailableCrossSell } from './methods/listAvailableCrossSell';
import { checkTestPlanAlreadyUsed } from './methods/checkTestPlanAlreadyUsed';
import { listCreditCardFee } from './methods/listCreditCardFee';
import { listMethodPayments } from './methods/listMethodPayments';

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
  public listPlanProductWithPrice = listPlanProductWithPrice;
  public listUserCards = listUserCards;
  public viewUserInfo = viewUserInfo;
  public listPlanSales = listPlanSales;
  public listPlanSalesSummary = listPlanSalesSummary;
  public listPlanWithItems = listPlanWithItems;
  public viewCurrentPlan = viewCurrentPlan;
  public calculateUpgradeDiscount = calculateUpgradeDiscount;
  public createOrderPayment = createOrderPayment;
  public listAvailableCrossSell = listAvailableCrossSell;
  public checkTestPlanAlreadyUsed = checkTestPlanAlreadyUsed;
  public listCreditCardFee = listCreditCardFee;
  public listMethodPayments = listMethodPayments;
}

export default PlanController;
