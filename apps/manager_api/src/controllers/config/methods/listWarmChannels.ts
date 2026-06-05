import { EHTTPStatusCode } from '@core/common/enums/EHTTPStatusCode';
import { sendResponse } from '@core/common/functions/sendResponse';
import { handleControllerError } from '@core/common/functions/handleControllerError';
import { FastifyReply, FastifyRequest } from 'fastify';
import { container } from 'tsyringe';
import { ListWarmChannelsRequest } from '@core/schema/config/listWarmChannels/request.schema';
import { WarmChannelsListerUseCase } from '@core/useCases/config/WarmChannelsLister.useCase';

export const listWarmChannels = async (
  request: FastifyRequest<{
    Querystring: ListWarmChannelsRequest;
  }>,
  reply: FastifyReply
) => {
  const warmChannelsListerUseCase = container.resolve(
    WarmChannelsListerUseCase
  );
  const { t } = request;

  try {
    const response = await warmChannelsListerUseCase.execute(request.query);

    return sendResponse(reply, {
      message: t('warm_channels_list_successfully'),
      httpStatusCode: EHTTPStatusCode.ok,
      data: response,
    });
  } catch (error) {
    handleControllerError(error, reply, t);
  }
};
