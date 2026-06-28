import { FastifyRequest, FastifyReply } from 'fastify';
import { container } from 'tsyringe';
import { GetPushPublicKeyResponse } from '@core/schema/push/getPublicKey/response.schema';
import { EHTTPStatusCode } from '@core/common/enums/EHTTPStatusCode';
import { sendResponse } from '@core/common/functions/sendResponse';
import { handleControllerError } from '@core/common/functions/handleControllerError';
import { PushPublicKeyViewerUseCase } from '@core/useCases/push/PushPublicKeyViewer.useCase';

export async function getPublicKey(
  request: FastifyRequest,
  reply: FastifyReply
): Promise<void> {
  const { t } = request;
  const pushPublicKeyViewerUseCase = container.resolve(
    PushPublicKeyViewerUseCase
  );

  try {
    const publicKey = pushPublicKeyViewerUseCase.execute();

    if (!publicKey) {
      return sendResponse(reply, {
        message: t('push_vapid_not_configured'),
        httpStatusCode: EHTTPStatusCode.internal_server_error,
      });
    }

    const response: GetPushPublicKeyResponse = {
      public_key: publicKey,
    };

    reply.header('Cache-Control', 'no-store, max-age=0');
    reply.header('Vary', 'Accept-Language');

    return sendResponse(reply, {
      message: t('push_public_key_retrieved_successfully'),
      httpStatusCode: EHTTPStatusCode.ok,
      data: response,
    });
  } catch (error) {
    handleControllerError(error, reply, t);
  }
}
