import { EHTTPStatusCode } from '@core/common/enums/EHTTPStatusCode';
import { sendResponse } from '@core/common/functions/sendResponse';
import { handleControllerError } from '@core/common/functions/handleControllerError';
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
    handleControllerError(error, reply, t);
  }
};
