import { EHTTPStatusCode } from '@core/common/enums/EHTTPStatusCode';
import { handleControllerError } from '@core/common/functions/handleControllerError';
import { sendResponse } from '@core/common/functions/sendResponse';
import { PublicApiTokenViewerUseCase } from '@core/useCases/integration/PublicApiTokenViewer.useCase';
import { FastifyReply, FastifyRequest } from 'fastify';
import { container } from 'tsyringe';

export const viewPublicApiToken = async (
  request: FastifyRequest,
  reply: FastifyReply
) => {
  const publicApiTokenViewerUseCase = container.resolve(
    PublicApiTokenViewerUseCase
  );
  const { t, tokenJwtData } = request;

  try {
    const result = await publicApiTokenViewerUseCase.execute(
      tokenJwtData.account_id
    );
    reply.header('Cache-Control', 'no-store');

    return sendResponse(reply, {
      message: t('public_api_token_viewed_successfully'),
      httpStatusCode: EHTTPStatusCode.ok,
      data: result,
    });
  } catch (error) {
    handleControllerError(error, reply, t);
  }
};
