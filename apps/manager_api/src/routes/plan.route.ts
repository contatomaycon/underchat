import { FastifyInstance } from 'fastify';
import { container } from 'tsyringe';
import {
  planViewPermissions,
  planCreatePermissions,
  planUpdatePermissions,
  planDeletePermissions,
  planInvoicePermissions,
} from '@/permissions';
import PlanController from '@/controllers/plan';
import { listPlanSchema } from '@core/schema/plan/listPlan';
import { listPlanAllSchema } from '@core/schema/plan/listPlanAll';
import { createPlanSchema } from '@core/schema/plan/createPlan';
import { updatePlanSchema } from '@core/schema/plan/updatePlan';
import { deletePlanSchema } from '@core/schema/plan/deletePlan';
import { createPlanItemSchema } from '@core/schema/plan/createPlanItem';
import { listPlanItemsSchema } from '@core/schema/plan/listPlanItems';
import { deletePlanItemSchema } from '@core/schema/plan/deletePlanItem';
import { listPlanProductAllSchema } from '@core/schema/plan/listPlanProductAll';
import { listPlanProductWithPriceSchema } from '@core/schema/plan/listPlanProductWithPrice';
import { listUserCardsSchema } from '@core/schema/plan/listUserCards';
import { viewUserInfoSchema } from '@core/schema/plan/viewUserInfo';
import { listPlanSalesSchema } from '@core/schema/plan/listPlanSales';
import { listPlanWithItemsSchema } from '@core/schema/plan/listPlanWithItems';
import { viewCurrentPlanSchema } from '@core/schema/plan/viewCurrentPlan';
import { calculateUpgradeDiscountSchema } from '@core/schema/plan/calculateUpgradeDiscount';
import { createOrderPaymentSchema } from '@core/schema/plan/createOrderPayment';
import { listAvailableCrossSellSchema } from '@core/schema/plan/listAvailableCrossSell';
import { checkTestPlanAlreadyUsedSchema } from '@core/schema/plan/checkTestPlanAlreadyUsed';
import { listPlanCreditCardFeeSchema } from '@core/schema/plan/listCreditCardFee';
import { listPlanMethodPaymentsSchema } from '@core/schema/plan/listMethodPayments';
import { planStatus } from '@/plugins/planStatus';

export default function planRoutes(server: FastifyInstance) {
  const planController = container.resolve(PlanController);

  server.get('/plan', {
    schema: listPlanSchema,
    handler: planController.listPlan,
    preHandler: [
      (request, reply) =>
        server.authenticateJwt(request, reply, planViewPermissions),
      planStatus,
    ],
  });

  server.get('/plan/all', {
    schema: listPlanAllSchema,
    handler: planController.listPlanAll,
    preHandler: [
      (request, reply) =>
        server.authenticateJwt(request, reply, planViewPermissions),
      planStatus,
    ],
  });

  server.post('/plan', {
    schema: createPlanSchema,
    handler: planController.createPlan,
    preHandler: [
      (request, reply) =>
        server.authenticateJwt(request, reply, planCreatePermissions),
      planStatus,
    ],
  });

  server.patch('/plan/:plan_id', {
    schema: updatePlanSchema,
    handler: planController.updatePlan,
    preHandler: [
      (request, reply) =>
        server.authenticateJwt(request, reply, planUpdatePermissions),
      planStatus,
    ],
  });

  server.delete('/plan/:plan_id', {
    schema: deletePlanSchema,
    handler: planController.deletePlan,
    preHandler: [
      (request, reply) =>
        server.authenticateJwt(request, reply, planDeletePermissions),
      planStatus,
    ],
  });

  server.post('/plan/item', {
    schema: createPlanItemSchema,
    handler: planController.createPlanItem,
    preHandler: [
      (request, reply) =>
        server.authenticateJwt(request, reply, planCreatePermissions),
      planStatus,
    ],
  });

  server.get('/plan/:plan_id/items', {
    schema: listPlanItemsSchema,
    handler: planController.listPlanItems,
    preHandler: [
      (request, reply) =>
        server.authenticateJwt(request, reply, planViewPermissions),
      planStatus,
    ],
  });

  server.delete('/plan/item/:plan_item_id', {
    schema: deletePlanItemSchema,
    handler: planController.deletePlanItem,
    preHandler: [
      (request, reply) =>
        server.authenticateJwt(request, reply, planDeletePermissions),
      planStatus,
    ],
  });

  server.get('/plan/product/all', {
    schema: listPlanProductAllSchema,
    handler: planController.listPlanProductAll,
    preHandler: [
      (request, reply) =>
        server.authenticateJwt(request, reply, planViewPermissions),
      planStatus,
    ],
  });

  server.get('/plan/product/with-price', {
    schema: listPlanProductWithPriceSchema,
    handler: planController.listPlanProductWithPrice,
    preHandler: [
      (request, reply) =>
        server.authenticateJwt(request, reply, planInvoicePermissions),
      planStatus,
    ],
  });

  server.get('/plan/user-cards', {
    schema: listUserCardsSchema,
    handler: planController.listUserCards,
    preHandler: [
      (request, reply) =>
        server.authenticateJwt(request, reply, planInvoicePermissions),
      planStatus,
    ],
  });

  server.get('/plan/user-info', {
    schema: viewUserInfoSchema,
    handler: planController.viewUserInfo,
    preHandler: [
      (request, reply) =>
        server.authenticateJwt(request, reply, planInvoicePermissions),
      planStatus,
    ],
  });

  server.get('/plan/sales', {
    schema: listPlanSalesSchema,
    handler: planController.listPlanSales,
    preHandler: [
      (request, reply) =>
        server.authenticateJwt(request, reply, planViewPermissions),
      planStatus,
    ],
  });

  server.get('/plan/with-items', {
    schema: listPlanWithItemsSchema,
    handler: planController.listPlanWithItems,
    preHandler: [
      (request, reply) =>
        server.authenticateJwt(request, reply, planInvoicePermissions),
      planStatus,
    ],
  });

  server.get('/plan/current-plan', {
    schema: viewCurrentPlanSchema,
    handler: planController.viewCurrentPlan,
    preHandler: [
      (request, reply) =>
        server.authenticateJwt(request, reply, planInvoicePermissions),
      planStatus,
    ],
  });

  server.get('/plan/upgrade-discount', {
    schema: calculateUpgradeDiscountSchema,
    handler: planController.calculateUpgradeDiscount,
    preHandler: [
      (request, reply) =>
        server.authenticateJwt(request, reply, planInvoicePermissions),
      planStatus,
    ],
  });

  server.get('/plan/credit-card-fee', {
    schema: listPlanCreditCardFeeSchema,
    handler: planController.listCreditCardFee,
    preHandler: [
      (request, reply) =>
        server.authenticateJwt(request, reply, planInvoicePermissions),
      planStatus,
    ],
  });

  server.get('/plan/method-payments', {
    schema: listPlanMethodPaymentsSchema,
    handler: planController.listMethodPayments,
    preHandler: [
      (request, reply) =>
        server.authenticateJwt(request, reply, planInvoicePermissions),
      planStatus,
    ],
  });

  server.post('/plan/order/payment', {
    schema: createOrderPaymentSchema,
    handler: planController.createOrderPayment,
    preHandler: [
      (request, reply) =>
        server.authenticateJwt(request, reply, planInvoicePermissions),
      planStatus,
    ],
  });

  server.get('/plan/cross-sell/available', {
    schema: listAvailableCrossSellSchema,
    handler: planController.listAvailableCrossSell,
    preHandler: [
      (request, reply) =>
        server.authenticateJwt(request, reply, planInvoicePermissions),
      planStatus,
    ],
  });

  server.get('/plan/check-test-already-used', {
    schema: checkTestPlanAlreadyUsedSchema,
    handler: planController.checkTestPlanAlreadyUsed,
    preHandler: [
      (request, reply) =>
        server.authenticateJwt(request, reply, planInvoicePermissions),
      planStatus,
    ],
  });
}
