import { EHTTPStatusCode } from '@core/common/enums/EHTTPStatusCode';
import { sendResponse } from '@core/common/functions/sendResponse';
import { FastifyReply, FastifyRequest } from 'fastify';
import { container } from 'tsyringe';
import { NfseViewerUseCase } from '@core/useCases/config/NfseViewer.useCase';

export const listNfse = async (
  request: FastifyRequest,
  reply: FastifyReply
) => {
  const nfseViewerUseCase = container.resolve(NfseViewerUseCase);
  const { t } = request;

  try {
    const response = await nfseViewerUseCase.execute(t);

    return sendResponse(reply, {
      message: t('nfse_viewed_successfully'),
      httpStatusCode: EHTTPStatusCode.ok,
      data: response,
    });
  } catch (error) {
    request.server.logger.error(error, request.id);

    if (error instanceof Error) {
      const notFoundMessage = t('nfse_not_found');
      const isNotFound = error.message === notFoundMessage;

      return sendResponse(reply, {
        message: error.message,
        httpStatusCode: isNotFound
          ? EHTTPStatusCode.not_found
          : EHTTPStatusCode.internal_server_error,
      });
    }

    return sendResponse(reply, {
      message: t('internal_server_error'),
      httpStatusCode: EHTTPStatusCode.internal_server_error,
    });
  }
};
