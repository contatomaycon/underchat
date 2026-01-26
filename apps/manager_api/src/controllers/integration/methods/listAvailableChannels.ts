import { EHTTPStatusCode } from '@core/common/enums/EHTTPStatusCode';
import { sendResponse } from '@core/common/functions/sendResponse';
import { handleControllerError } from '@core/common/functions/handleControllerError';
import { FastifyReply, FastifyRequest } from 'fastify';
import { container } from 'tsyringe';
import { IntegrationAvailableChannelsListerUseCase } from '@core/useCases/integration/IntegrationAvailableChannelsLister.useCase';

export const listAvailableChannels = async (
  request: FastifyRequest,
  reply: FastifyReply
) => {
  const integrationAvailableChannelsListerUseCase = container.resolve(
    IntegrationAvailableChannelsListerUseCase
  );
  const { t, tokenJwtData } = request;

  try {
    const result = await integrationAvailableChannelsListerUseCase.execute(
      tokenJwtData.account_id
    );

    return sendResponse(reply, {
      message: t('channels_listed_successfully'),
      httpStatusCode: EHTTPStatusCode.ok,
      data: result,
    });
  } catch (error) {
    handleControllerError(error, reply, t);
  }
};
