import { EHTTPStatusCode } from '@core/common/enums/EHTTPStatusCode';
import { sendResponse } from '@core/common/functions/sendResponse';
import { FastifyReply, FastifyRequest } from 'fastify';
import { container } from 'tsyringe';
import { NfseUpdaterUseCase } from '@core/useCases/config/NfseUpdater.useCase';
import { UpdateNfseRequest } from '@core/schema/config/updateNfse/request.schema';

export const updateNfse = async (
  request: FastifyRequest<{ Body: UpdateNfseRequest }>,
  reply: FastifyReply
) => {
  const nfseUpdaterUseCase = container.resolve(NfseUpdaterUseCase);
  const { t, body } = request;

  try {
    const response = await nfseUpdaterUseCase.execute(t, body);

    return sendResponse(reply, {
      message: t('nfse_updated_successfully'),
      httpStatusCode: EHTTPStatusCode.ok,
      data: response,
    });
  } catch (error) {
    console.error(error);

    if (error instanceof Error) {
      return sendResponse(reply, {
        message: error.message,
        httpStatusCode: EHTTPStatusCode.internal_server_error,
      });
    }

    return sendResponse(reply, {
      message: t('internal_server_error'),
      httpStatusCode: EHTTPStatusCode.internal_server_error,
    });
  }
};
