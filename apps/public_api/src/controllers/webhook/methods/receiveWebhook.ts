import { EHTTPStatusCode } from '@core/common/enums/EHTTPStatusCode';
import { sendResponse } from '@core/common/functions/sendResponse';
import { handleControllerError } from '@core/common/functions/handleControllerError';
import { FastifyReply, FastifyRequest } from 'fastify';
import { container } from 'tsyringe';
import { ReceiveWebhookRequest } from '@core/schema/webhook/receiveWebhook/request.schema';
import { WebhookReceiverUseCase } from '@core/useCases/webhook/WebhookReceiver.useCase';
import { EPlanProduct } from '@core/common/enums/EPlanProduct';
import {
  PlanEntitlementDeniedError,
  PlanEntitlementRevisionMismatchError,
  PlanEntitlementUnavailableError,
} from '@core/common/exceptions/PlanEntitlementError';
import {
  createPlanEntitlementAuditContext,
  getPlanEntitlementAuditSource,
  planEntitlementTelemetryStore,
} from '@core/services/planEntitlementTelemetryStore';

export const receiveWebhook = async (
  request: FastifyRequest<{
    Body: ReceiveWebhookRequest;
  }>,
  reply: FastifyReply
) => {
  const webhookReceiverUseCase = container.resolve(WebhookReceiverUseCase);
  const {
    t,
    tokenKeyData,
    integrationEntitlementRevision,
    integrationEntitlementSource,
  } = request;

  if (!tokenKeyData) {
    return sendResponse(reply, {
      message: t('not_authorized'),
      httpStatusCode: EHTTPStatusCode.unauthorized,
    });
  }

  if (!integrationEntitlementRevision) {
    planEntitlementTelemetryStore.recordDecision(
      'inbound_webhook_processing',
      'unavailable'
    );
    return sendResponse(reply, {
      message: t('plan_entitlement_unavailable'),
      httpStatusCode: EHTTPStatusCode.service_unavailable,
      data: {
        reason: 'plan_entitlement_unavailable',
        plan_product_id: EPlanProduct.integration,
      },
    });
  }

  try {
    const success = await webhookReceiverUseCase.execute(
      t,
      tokenKeyData,
      request.body,
      integrationEntitlementRevision,
      request.id
    );
    planEntitlementTelemetryStore.recordDecision(
      'inbound_webhook_processing',
      'allowed'
    );
    request.log?.info?.(
      createPlanEntitlementAuditContext({
        surface: 'inbound_webhook_processing',
        outcome: 'allowed',
        accountId: tokenKeyData.account_id,
        planProductId: EPlanProduct.integration,
        revision: integrationEntitlementRevision,
        source: integrationEntitlementSource,
        requestId: request.id,
      }),
      'Inbound webhook Integration preflight admitted'
    );

    return sendResponse(reply, {
      message: t('webhook_received_successfully'),
      httpStatusCode: EHTTPStatusCode.ok,
      data: { success },
    });
  } catch (error) {
    if (error instanceof PlanEntitlementDeniedError) {
      planEntitlementTelemetryStore.recordDecision(
        'inbound_webhook_processing',
        'denied'
      );
      request.log?.warn?.(
        createPlanEntitlementAuditContext({
          surface: 'inbound_webhook_processing',
          outcome: 'denied',
          accountId: tokenKeyData.account_id,
          planProductId: EPlanProduct.integration,
          revision: error.entitlement.revision,
          source: getPlanEntitlementAuditSource(error.entitlement),
          requestId: request.id,
          reason: 'integration_plan_required',
        }),
        'Inbound webhook Integration preflight denied'
      );
      return sendResponse(reply, {
        message: t('integration_not_available'),
        httpStatusCode: EHTTPStatusCode.payment_required,
        data: {
          reason: 'integration_plan_required',
          plan_product_id: EPlanProduct.integration,
        },
      });
    }
    if (error instanceof PlanEntitlementRevisionMismatchError) {
      planEntitlementTelemetryStore.recordDecision(
        'inbound_webhook_processing',
        'denied'
      );
      request.log?.warn?.(
        createPlanEntitlementAuditContext({
          surface: 'inbound_webhook_processing',
          outcome: 'denied',
          accountId: tokenKeyData.account_id,
          planProductId: EPlanProduct.integration,
          revision: error.entitlement.revision,
          source: getPlanEntitlementAuditSource(error.entitlement),
          requestId: request.id,
          reason: 'integration_entitlement_epoch_mismatch',
        }),
        'Inbound webhook Integration epoch rejected'
      );
      return sendResponse(reply, {
        message: t('integration_not_available'),
        httpStatusCode: EHTTPStatusCode.conflict,
        data: {
          reason: 'integration_entitlement_epoch_mismatch',
          plan_product_id: EPlanProduct.integration,
        },
      });
    }
    if (error instanceof PlanEntitlementUnavailableError) {
      planEntitlementTelemetryStore.recordDecision(
        'inbound_webhook_processing',
        'unavailable'
      );
      return sendResponse(reply, {
        message: t('plan_entitlement_unavailable'),
        httpStatusCode: EHTTPStatusCode.service_unavailable,
        data: {
          reason: 'plan_entitlement_unavailable',
          plan_product_id: EPlanProduct.integration,
        },
      });
    }
    handleControllerError(error, reply, t);
  }
};
