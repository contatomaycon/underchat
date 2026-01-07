import { FastifyRequest, FastifyReply } from 'fastify';
import { container } from 'tsyringe';
import { PushSubscriptionDeleterRepository } from '@core/repositories/push/PushSubscriptionDeleter.repository';
import { DeletePushSubscriptionRequest } from '@core/schema/push/deleteSubscription/request.schema';
import { EHTTPStatusCode } from '@core/common/enums/EHTTPStatusCode';
import { sendResponse } from '@core/common/functions/sendResponse';
import { handleControllerError } from '@core/common/functions/handleControllerError';

export async function deleteSubscription(
  request: FastifyRequest<{
    Body: DeletePushSubscriptionRequest;
  }>,
  reply: FastifyReply
): Promise<void> {
  const { t } = request;
  const pushSubscriptionDeleterRepository = container.resolve(
    PushSubscriptionDeleterRepository
  );

  try {
    const { endpoint } = request.body;

    await pushSubscriptionDeleterRepository.deleteByEndpoint(endpoint);

    return sendResponse(reply, {
      message: t('push_subscription_deleted_successfully'),
      httpStatusCode: EHTTPStatusCode.ok,
    });
  } catch (error) {
    handleControllerError(error, reply, t);
  }
}
