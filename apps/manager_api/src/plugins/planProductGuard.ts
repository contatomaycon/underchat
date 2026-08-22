import { FastifyReply, FastifyRequest } from 'fastify';
import { container } from 'tsyringe';
import { EHTTPStatusCode } from '@core/common/enums/EHTTPStatusCode';
import { EPlanProduct } from '@core/common/enums/EPlanProduct';
import {
  PlanEntitlementDeniedError,
  PlanEntitlementUnavailableError,
} from '@core/common/exceptions/PlanEntitlementError';
import { sendResponse } from '@core/common/functions/sendResponse';
import { PlanEntitlementService } from '@core/services/planEntitlement.service';
import {
  createPlanEntitlementAuditContext,
  getPlanEntitlementAuditSource,
  planEntitlementTelemetryStore,
} from '@core/services/planEntitlementTelemetryStore';
import { AccountService } from '@core/services/account.service';

const getProductDeniedResponse = (planProductId: EPlanProduct) => {
  if (planProductId === EPlanProduct.integration) {
    return {
      messageKey: 'integration_not_available',
      reason: 'integration_plan_required',
    } as const;
  }

  if (planProductId === EPlanProduct.internal_chat) {
    return {
      messageKey: 'internal_chat_not_available',
      reason: 'plan_product_required',
    } as const;
  }

  return {
    messageKey: 'permission_denied',
    reason: 'plan_product_required',
  } as const;
};

export const planProductGuard = (planProductId: EPlanProduct) => {
  return async (request: FastifyRequest, reply: FastifyReply) => {
    if (reply.sent) {
      return;
    }

    const accountId = request.tokenJwtData?.account_id;

    if (!accountId) {
      return sendResponse(reply, {
        message: request.t('not_authorized'),
        httpStatusCode: EHTTPStatusCode.unauthorized,
      });
    }

    // Integration has revision/fence semantics. Other products keep the
    // established active-product lookup until their mutation hooks are also
    // revision-aware, preventing stale entitlement cache regressions.
    if (planProductId !== EPlanProduct.integration) {
      const productIds = await container
        .resolve(AccountService)
        .listActivePlanProductIds(accountId);
      if (productIds.includes(planProductId)) return;

      const denied = getProductDeniedResponse(planProductId);
      return sendResponse(reply, {
        message: request.t(denied.messageKey),
        httpStatusCode: EHTTPStatusCode.payment_required,
        data: {
          reason: denied.reason,
          plan_product_id: planProductId,
        },
      });
    }

    try {
      const entitlement = await container
        .resolve(PlanEntitlementService)
        .assertEntitled(accountId, planProductId);
      if (planProductId === EPlanProduct.integration) {
        planEntitlementTelemetryStore.recordDecision('manager_api', 'allowed');
        request.log?.info?.(
          createPlanEntitlementAuditContext({
            surface: 'manager_api',
            outcome: 'allowed',
            accountId,
            planProductId,
            revision: entitlement.revision,
            source: entitlement.source,
            requestId: request.id ?? reply.request.id,
          }),
          'Plan entitlement request admitted'
        );
      }
      return;
    } catch (error) {
      if (error instanceof PlanEntitlementDeniedError) {
        if (planProductId === EPlanProduct.integration) {
          planEntitlementTelemetryStore.recordDecision('manager_api', 'denied');
          request.log?.warn?.(
            createPlanEntitlementAuditContext({
              surface: 'manager_api',
              outcome: 'denied',
              accountId,
              planProductId,
              revision: error.entitlement.revision,
              source: getPlanEntitlementAuditSource(error.entitlement),
              requestId: request.id ?? reply.request.id,
              reason: 'integration_plan_required',
            }),
            'Plan entitlement request denied'
          );
        }
        const denied = getProductDeniedResponse(planProductId);
        return sendResponse(reply, {
          message: request.t(denied.messageKey),
          httpStatusCode: EHTTPStatusCode.payment_required,
          data: {
            reason: denied.reason,
            plan_product_id: planProductId,
          },
        });
      }

      if (planProductId === EPlanProduct.integration) {
        planEntitlementTelemetryStore.recordDecision(
          'manager_api',
          'unavailable'
        );
      }
      request.log.error(
        {
          type: 'plan_product_guard_error',
          account_id: accountId,
          plan_product_id: planProductId,
          expected_error: error instanceof PlanEntitlementUnavailableError,
          error: error instanceof Error ? error.message : String(error),
        },
        'Plan product entitlement validation unavailable'
      );
      return sendResponse(reply, {
        message: request.t('plan_entitlement_unavailable'),
        httpStatusCode: EHTTPStatusCode.service_unavailable,
        data: {
          reason: 'plan_entitlement_unavailable',
          plan_product_id: planProductId,
        },
      });
    }
  };
};
