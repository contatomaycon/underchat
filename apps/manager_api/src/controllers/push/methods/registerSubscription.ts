import { FastifyRequest, FastifyReply } from 'fastify';
import { container } from 'tsyringe';
import { PushSubscriptionCreatorRepository } from '@core/repositories/push/PushSubscriptionCreator.repository';
import { PushNotificationService } from '@core/services/pushNotification.service';
import { RegisterPushSubscriptionRequest } from '@core/schema/push/registerSubscription/request.schema';
import { RegisterPushSubscriptionResponse } from '@core/schema/push/registerSubscription/response.schema';
import { EHTTPStatusCode } from '@core/common/enums/EHTTPStatusCode';
import { sendResponse } from '@core/common/functions/sendResponse';
import { handleControllerError } from '@core/common/functions/handleControllerError';

export async function registerSubscription(
  request: FastifyRequest<{
    Body: RegisterPushSubscriptionRequest;
  }>,
  reply: FastifyReply
): Promise<void> {
  const { t, tokenJwtData } = request;
  const userId = tokenJwtData.user_id;

  const pushSubscriptionCreatorRepository = container.resolve(
    PushSubscriptionCreatorRepository
  );
  const pushNotificationService = container.resolve(PushNotificationService);

  try {
    const { endpoint, keys, user_agent } = request.body;

    const result = await pushSubscriptionCreatorRepository.createOrUpdate({
      user_id: userId,
      endpoint,
      p256dh: keys.p256dh,
      auth: keys.auth,
      user_agent: user_agent || request.headers['user-agent'] || undefined,
    });

    const publicKey = pushNotificationService.getPublicKey();

    if (!publicKey) {
      return sendResponse(reply, {
        message: t('push_vapid_not_configured'),
        httpStatusCode: EHTTPStatusCode.internal_server_error,
      });
    }

    const response: RegisterPushSubscriptionResponse = {
      push_subscription_id: result.push_subscription_id,
      public_key: publicKey,
    };

    return sendResponse(reply, {
      message: t('push_subscription_registered_successfully'),
      httpStatusCode: EHTTPStatusCode.created,
      data: response,
    });
  } catch (error) {
    handleControllerError(error, reply, t);
  }
}
