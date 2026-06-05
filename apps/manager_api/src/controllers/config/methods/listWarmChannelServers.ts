import { EHTTPStatusCode } from '@core/common/enums/EHTTPStatusCode';
import { sendResponse } from '@core/common/functions/sendResponse';
import { handleControllerError } from '@core/common/functions/handleControllerError';
import { FastifyReply, FastifyRequest } from 'fastify';
import { container } from 'tsyringe';
import { WarmChannelServersListerUseCase } from '@core/useCases/config/WarmChannelServersLister.useCase';

export const listWarmChannelServers = async (
  request: FastifyRequest,
  reply: FastifyReply
) => {
  const warmChannelServersListerUseCase = container.resolve(
    WarmChannelServersListerUseCase
  );
  const { t } = request;

  try {
    const response = await warmChannelServersListerUseCase.execute();

    return sendResponse(reply, {
      message: t('warm_channel_servers_list_successfully'),
      httpStatusCode: EHTTPStatusCode.ok,
      data: response,
    });
  } catch (error) {
    handleControllerError(error, reply, t);
  }
};
