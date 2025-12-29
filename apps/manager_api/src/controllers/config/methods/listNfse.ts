import { EHTTPStatusCode } from '@core/common/enums/EHTTPStatusCode';
import { sendResponse } from '@core/common/functions/sendResponse';
import { handleControllerError } from '@core/common/functions/handleControllerError';
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
    handleControllerError(error, reply, t);
  }
};
