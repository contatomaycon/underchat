import { EHTTPStatusCode } from '@core/common/enums/EHTTPStatusCode';
import { sendResponse } from '@core/common/functions/sendResponse';
import { handleControllerError } from '@core/common/functions/handleControllerError';
import { FastifyReply, FastifyRequest } from 'fastify';
import { container } from 'tsyringe';
import { ReceiveWebhookRequest } from '@core/schema/webhook/receiveWebhook/request.schema';
import { WebhookReceiverUseCase } from '@core/useCases/webhook/WebhookReceiver.useCase';

export const receiveWebhook = async (
  request: FastifyRequest<{
    Body: ReceiveWebhookRequest;
  }>,
  reply: FastifyReply
) => {
  const webhookReceiverUseCase = container.resolve(WebhookReceiverUseCase);
  const { t, tokenKeyData } = request;

  if (!tokenKeyData) {
    return sendResponse(reply, {
      message: t('not_authorized'),
      httpStatusCode: EHTTPStatusCode.unauthorized,
    });
  }

  try {
    const success = await webhookReceiverUseCase.execute(
      t,
      tokenKeyData,
      request.body
    );

    return sendResponse(reply, {
      message: t('webhook_received_successfully'),
      httpStatusCode: EHTTPStatusCode.ok,
      data: { success },
    });
  } catch (error) {
    handleControllerError(error, reply, t);
  }
};
