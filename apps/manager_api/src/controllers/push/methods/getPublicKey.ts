import { FastifyRequest, FastifyReply } from 'fastify';
import { container } from 'tsyringe';
import { PushNotificationService } from '@core/services/pushNotification.service';
import { GetPushPublicKeyResponse } from '@core/schema/push/getPublicKey/response.schema';
import { EHTTPStatusCode } from '@core/common/enums/EHTTPStatusCode';
import { sendResponse } from '@core/common/functions/sendResponse';
import { handleControllerError } from '@core/common/functions/handleControllerError';

export async function getPublicKey(
  request: FastifyRequest,
  reply: FastifyReply
): Promise<void> {
  const { t } = request;
  const pushNotificationService = container.resolve(PushNotificationService);

  try {
    const publicKey = pushNotificationService.getPublicKey();

    if (!publicKey) {
      return sendResponse(reply, {
        message: t('push_vapid_not_configured'),
        httpStatusCode: EHTTPStatusCode.internal_server_error,
      });
    }

    const response: GetPushPublicKeyResponse = {
      public_key: publicKey,
    };

    return sendResponse(reply, {
      message: t('push_public_key_retrieved_successfully'),
      httpStatusCode: EHTTPStatusCode.ok,
      data: response,
    });
  } catch (error) {
    handleControllerError(error, reply, t);
  }
}
