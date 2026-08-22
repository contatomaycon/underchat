import type { TFunction } from 'i18next';
import type { FastifyReply, FastifyRequest } from 'fastify';
import { container } from 'tsyringe';
import { EHTTPStatusCode } from '@core/common/enums/EHTTPStatusCode';
import { handleControllerError } from '@core/common/functions/handleControllerError';
import { sendResponse } from '@core/common/functions/sendResponse';
import {
  OutboundWebhookServiceError,
  type OutboundWebhookServiceErrorCode,
} from '@core/services/outboundWebhook.service';
import type {
  ActivateOutboundWebhookRequest,
  CreateOutboundWebhookRequest,
  ListOutboundWebhookDeliveriesQuery,
  OutboundWebhookDeliveryParams,
  OutboundWebhookIdParams,
  UpdateOutboundWebhookRequest,
} from '@core/schema/integration/outboundWebhook/request.schema';
import { OutboundWebhookEventsListerUseCase } from '@core/useCases/integration/OutboundWebhookEventsLister.useCase';
import { OutboundWebhookListerUseCase } from '@core/useCases/integration/OutboundWebhookLister.useCase';
import { OutboundWebhookViewerUseCase } from '@core/useCases/integration/OutboundWebhookViewer.useCase';
import { OutboundWebhookCreatorUseCase } from '@core/useCases/integration/OutboundWebhookCreator.useCase';
import { OutboundWebhookUpdaterUseCase } from '@core/useCases/integration/OutboundWebhookUpdater.useCase';
import { OutboundWebhookDeleterUseCase } from '@core/useCases/integration/OutboundWebhookDeleter.useCase';
import { OutboundWebhookTesterUseCase } from '@core/useCases/integration/OutboundWebhookTester.useCase';
import { OutboundWebhookSecretRotatorUseCase } from '@core/useCases/integration/OutboundWebhookSecretRotator.useCase';
import { OutboundWebhookActivationUpdaterUseCase } from '@core/useCases/integration/OutboundWebhookActivationUpdater.useCase';
import { OutboundWebhookDeliveryListerUseCase } from '@core/useCases/integration/OutboundWebhookDeliveryLister.useCase';
import { OutboundWebhookDeliveryViewerUseCase } from '@core/useCases/integration/OutboundWebhookDeliveryViewer.useCase';
import { OutboundWebhookDeliveryRedelivererUseCase } from '@core/useCases/integration/OutboundWebhookDeliveryRedeliverer.useCase';
import { EPlanProduct } from '@core/common/enums/EPlanProduct';

function statusForError(
  code: OutboundWebhookServiceErrorCode
): EHTTPStatusCode {
  if (
    code === 'invalid_name' ||
    code === 'invalid_url' ||
    code === 'invalid_event_types' ||
    code === 'invalid_channel' ||
    code === 'invalid_cursor'
  ) {
    return EHTTPStatusCode.bad_request;
  }
  if (code === 'not_found') return EHTTPStatusCode.not_found;
  if (code === 'integration_plan_required') {
    return EHTTPStatusCode.payment_required;
  }
  if (code === 'plan_entitlement_unavailable') {
    return EHTTPStatusCode.service_unavailable;
  }
  if (code === 'account_ineligible') return EHTTPStatusCode.forbidden;
  if (code === 'endpoint_limit') return EHTTPStatusCode.conflict;
  if (code === 'entitlement_epoch_mismatch') {
    return EHTTPStatusCode.conflict;
  }
  if (
    code === 'no_events' ||
    code === 'channel_unavailable' ||
    code === 'unverified' ||
    code === 'endpoint_inactive' ||
    code === 'not_redeliverable' ||
    code === 'concurrent_update'
  ) {
    return EHTTPStatusCode.conflict;
  }
  return EHTTPStatusCode.internal_server_error;
}

function handleOutboundWebhookError(
  error: unknown,
  reply: FastifyReply,
  t: TFunction<'translation', undefined>
): void {
  if (error instanceof OutboundWebhookServiceError) {
    if (
      error.code === 'integration_plan_required' ||
      error.code === 'plan_entitlement_unavailable'
    ) {
      sendResponse(reply, {
        message: t(
          error.code === 'integration_plan_required'
            ? 'integration_not_available'
            : 'plan_entitlement_unavailable'
        ),
        httpStatusCode: statusForError(error.code),
        data: {
          reason: error.code,
          plan_product_id: EPlanProduct.integration,
        },
      });
      return;
    }
    if (error.code === 'entitlement_epoch_mismatch') {
      sendResponse(reply, {
        message: error.message,
        httpStatusCode: EHTTPStatusCode.conflict,
        data: {
          reason: 'integration_entitlement_epoch_mismatch',
          plan_product_id: EPlanProduct.integration,
        },
      });
      return;
    }
    sendResponse(reply, {
      message: error.message,
      httpStatusCode: statusForError(error.code),
    });
    return;
  }
  handleControllerError(error, reply, t);
}

export const listOutboundWebhookEvents = async (
  request: FastifyRequest,
  reply: FastifyReply
) => {
  try {
    const result = container
      .resolve(OutboundWebhookEventsListerUseCase)
      .execute();
    return sendResponse(reply, {
      message: 'outbound_webhook_events_listed',
      data: result,
    });
  } catch (error) {
    handleOutboundWebhookError(error, reply, request.t);
  }
};

export const listOutboundWebhooks = async (
  request: FastifyRequest,
  reply: FastifyReply
) => {
  try {
    const result = await container
      .resolve(OutboundWebhookListerUseCase)
      .execute(request.tokenJwtData.account_id);
    return sendResponse(reply, {
      message: 'outbound_webhooks_listed',
      data: { items: result },
    });
  } catch (error) {
    handleOutboundWebhookError(error, reply, request.t);
  }
};

export const viewOutboundWebhook = async (
  request: FastifyRequest<{ Params: OutboundWebhookIdParams }>,
  reply: FastifyReply
) => {
  try {
    const result = await container
      .resolve(OutboundWebhookViewerUseCase)
      .execute(request.tokenJwtData.account_id, request.params.id);
    return sendResponse(reply, {
      message: 'outbound_webhook_viewed',
      data: result,
    });
  } catch (error) {
    handleOutboundWebhookError(error, reply, request.t);
  }
};

export const createOutboundWebhook = async (
  request: FastifyRequest<{ Body: CreateOutboundWebhookRequest }>,
  reply: FastifyReply
) => {
  try {
    const result = await container
      .resolve(OutboundWebhookCreatorUseCase)
      .execute(request.tokenJwtData.account_id, request.body);
    reply.header('Cache-Control', 'no-store');
    return sendResponse(reply, {
      message: 'outbound_webhook_created',
      httpStatusCode: EHTTPStatusCode.created,
      data: result,
    });
  } catch (error) {
    handleOutboundWebhookError(error, reply, request.t);
  }
};

export const updateOutboundWebhook = async (
  request: FastifyRequest<{
    Params: OutboundWebhookIdParams;
    Body: UpdateOutboundWebhookRequest;
  }>,
  reply: FastifyReply
) => {
  try {
    const result = await container
      .resolve(OutboundWebhookUpdaterUseCase)
      .execute(
        request.tokenJwtData.account_id,
        request.params.id,
        request.body
      );
    return sendResponse(reply, {
      message: 'outbound_webhook_updated',
      data: result,
    });
  } catch (error) {
    handleOutboundWebhookError(error, reply, request.t);
  }
};

export const deleteOutboundWebhook = async (
  request: FastifyRequest<{ Params: OutboundWebhookIdParams }>,
  reply: FastifyReply
) => {
  try {
    const result = await container
      .resolve(OutboundWebhookDeleterUseCase)
      .execute(request.tokenJwtData.account_id, request.params.id);
    return sendResponse(reply, {
      message: 'outbound_webhook_deleted',
      data: result,
    });
  } catch (error) {
    handleOutboundWebhookError(error, reply, request.t);
  }
};

export const testOutboundWebhook = async (
  request: FastifyRequest<{ Params: OutboundWebhookIdParams }>,
  reply: FastifyReply
) => {
  try {
    const result = await container
      .resolve(OutboundWebhookTesterUseCase)
      .execute(
        request.tokenJwtData.account_id,
        request.params.id,
        request.tokenJwtData.user_id
      );
    return sendResponse(reply, {
      message: 'outbound_webhook_test_enqueued',
      httpStatusCode: EHTTPStatusCode.accepted,
      data: result,
    });
  } catch (error) {
    handleOutboundWebhookError(error, reply, request.t);
  }
};

export const rotateOutboundWebhookSecret = async (
  request: FastifyRequest<{ Params: OutboundWebhookIdParams }>,
  reply: FastifyReply
) => {
  try {
    const result = await container
      .resolve(OutboundWebhookSecretRotatorUseCase)
      .execute(request.tokenJwtData.account_id, request.params.id);
    reply.header('Cache-Control', 'no-store');
    return sendResponse(reply, {
      message: 'outbound_webhook_secret_rotated',
      data: result,
    });
  } catch (error) {
    handleOutboundWebhookError(error, reply, request.t);
  }
};

export const activateOutboundWebhook = async (
  request: FastifyRequest<{
    Params: OutboundWebhookIdParams;
    Body: ActivateOutboundWebhookRequest;
  }>,
  reply: FastifyReply
) => {
  try {
    const result = await container
      .resolve(OutboundWebhookActivationUpdaterUseCase)
      .execute(
        request.tokenJwtData.account_id,
        request.params.id,
        request.body.active
      );
    return sendResponse(reply, {
      message: request.body.active
        ? 'outbound_webhook_activated'
        : 'outbound_webhook_deactivated',
      data: result,
    });
  } catch (error) {
    handleOutboundWebhookError(error, reply, request.t);
  }
};

export const listOutboundWebhookDeliveries = async (
  request: FastifyRequest<{
    Params: OutboundWebhookIdParams;
    Querystring: ListOutboundWebhookDeliveriesQuery;
  }>,
  reply: FastifyReply
) => {
  try {
    const result = await container
      .resolve(OutboundWebhookDeliveryListerUseCase)
      .execute(
        request.tokenJwtData.account_id,
        request.params.id,
        request.query.limit,
        request.query.cursor
      );
    return sendResponse(reply, {
      message: 'outbound_webhook_deliveries_listed',
      data: result,
    });
  } catch (error) {
    handleOutboundWebhookError(error, reply, request.t);
  }
};

export const viewOutboundWebhookDelivery = async (
  request: FastifyRequest<{ Params: OutboundWebhookDeliveryParams }>,
  reply: FastifyReply
) => {
  try {
    const result = await container
      .resolve(OutboundWebhookDeliveryViewerUseCase)
      .execute(
        request.tokenJwtData.account_id,
        request.params.id,
        request.params.deliveryId
      );
    return sendResponse(reply, {
      message: 'outbound_webhook_delivery_viewed',
      data: result,
    });
  } catch (error) {
    handleOutboundWebhookError(error, reply, request.t);
  }
};

export const redeliverOutboundWebhookDelivery = async (
  request: FastifyRequest<{ Params: OutboundWebhookDeliveryParams }>,
  reply: FastifyReply
) => {
  try {
    const result = await container
      .resolve(OutboundWebhookDeliveryRedelivererUseCase)
      .execute(
        request.tokenJwtData.account_id,
        request.params.id,
        request.params.deliveryId,
        request.tokenJwtData.user_id
      );
    return sendResponse(reply, {
      message: 'outbound_webhook_redelivery_enqueued',
      httpStatusCode: EHTTPStatusCode.accepted,
      data: result,
    });
  } catch (error) {
    handleOutboundWebhookError(error, reply, request.t);
  }
};
