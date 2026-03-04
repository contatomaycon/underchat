import { FastifyRequest, FastifyReply } from 'fastify';
import { container } from 'tsyringe';
import { RegisterPushSubscriptionRequest } from '@core/schema/push/registerSubscription/request.schema';
import { EHTTPStatusCode } from '@core/common/enums/EHTTPStatusCode';
import { sendResponse } from '@core/common/functions/sendResponse';
import { handleControllerError } from '@core/common/functions/handleControllerError';
import { PushSubscriptionRegistrarUseCase } from '@core/useCases/push/PushSubscriptionRegistrar.useCase';

export async function registerSubscription(
  request: FastifyRequest<{
    Body: RegisterPushSubscriptionRequest;
  }>,
  reply: FastifyReply
): Promise<void> {
  const { t, tokenJwtData } = request;
  const pushSubscriptionRegistrarUseCase = container.resolve(
    PushSubscriptionRegistrarUseCase
  );

  try {
    const result = await pushSubscriptionRegistrarUseCase.execute({
      userId: tokenJwtData.user_id,
      endpoint: request.body.endpoint,
      provider: request.body.provider,
      platform: request.body.platform,
      keys: request.body.keys,
      userAgent: request.body.user_agent || request.headers['user-agent'],
    });

    if (!result.ok) {
      if (result.reason === 'invalid_payload') {
        return sendResponse(reply, {
          message: 'Invalid push subscription payload.',
          httpStatusCode: EHTTPStatusCode.bad_request,
        });
      }

      return sendResponse(reply, {
        message: t('push_vapid_not_configured'),
        httpStatusCode: EHTTPStatusCode.internal_server_error,
      });
    }

    return sendResponse(reply, {
      message: t('push_subscription_registered_successfully'),
      httpStatusCode: EHTTPStatusCode.created,
      data: result.data,
    });
  } catch (error) {
    handleControllerError(error, reply, t);
  }
}
