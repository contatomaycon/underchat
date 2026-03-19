import { EHTTPStatusCode } from '@core/common/enums/EHTTPStatusCode';
import { sendResponse } from '@core/common/functions/sendResponse';
import { handleControllerError } from '@core/common/functions/handleControllerError';
import { FastifyReply, FastifyRequest } from 'fastify';
import { container } from 'tsyringe';
import { NfseIntegrationUpdaterUseCase } from '@core/useCases/config/NfseIntegrationUpdater.useCase';
import { UpdateNfseIntegrationRequest } from '@core/schema/config/updateNfseIntegration/request.schema';

export const updateNfseIntegration = async (
  request: FastifyRequest<{
    Body: UpdateNfseIntegrationRequest;
  }>,
  reply: FastifyReply
) => {
  const nfseIntegrationUpdaterUseCase = container.resolve(
    NfseIntegrationUpdaterUseCase
  );
  const { t, body } = request;

  try {
    const response = await nfseIntegrationUpdaterUseCase.execute(t, body);

    return sendResponse(reply, {
      message: t('nfse_integration_updated_successfully'),
      httpStatusCode: EHTTPStatusCode.ok,
      data: response,
    });
  } catch (error) {
    handleControllerError(error, reply, t);
  }
};
