import { FastifyRequest, FastifyReply } from 'fastify';
import { container } from 'tsyringe';
import { DeletePushSubscriptionRequest } from '@core/schema/push/deleteSubscription/request.schema';
import { EHTTPStatusCode } from '@core/common/enums/EHTTPStatusCode';
import { sendResponse } from '@core/common/functions/sendResponse';
import { handleControllerError } from '@core/common/functions/handleControllerError';
import { PushSubscriptionDeleterUseCase } from '@core/useCases/push/PushSubscriptionDeleter.useCase';

export async function deleteSubscription(
  request: FastifyRequest<{
    Body: DeletePushSubscriptionRequest;
  }>,
  reply: FastifyReply
): Promise<void> {
  const { t, tokenJwtData } = request;
  const pushSubscriptionDeleterUseCase = container.resolve(
    PushSubscriptionDeleterUseCase
  );

  try {
    const result = await pushSubscriptionDeleterUseCase.execute({
      userId: tokenJwtData.user_id,
      endpoint: request.body.endpoint,
      provider: request.body.provider,
    });

    if (!result.ok && result.reason === 'invalid_payload') {
      return sendResponse(reply, {
        message: 'Invalid push subscription payload.',
        httpStatusCode: EHTTPStatusCode.bad_request,
      });
    }

    return sendResponse(reply, {
      message: t('push_subscription_deleted_successfully'),
      httpStatusCode: EHTTPStatusCode.ok,
    });
  } catch (error) {
    handleControllerError(error, reply, t);
  }
}
