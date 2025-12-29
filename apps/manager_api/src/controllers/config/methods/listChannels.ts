import { EHTTPStatusCode } from '@core/common/enums/EHTTPStatusCode';
import { sendResponse } from '@core/common/functions/sendResponse';
import { handleControllerError } from '@core/common/functions/handleControllerError';
import { FastifyReply, FastifyRequest } from 'fastify';
import { container } from 'tsyringe';
import { ListChannelsRequest } from '@core/schema/config/listChannels/request.schema';
import { ChannelsListerUseCase } from '@core/useCases/config/ChannelsLister.useCase';

export const listChannels = async (
  request: FastifyRequest<{
    Querystring: ListChannelsRequest;
  }>,
  reply: FastifyReply
) => {
  const channelsListerUseCase = container.resolve(ChannelsListerUseCase);
  const { t } = request;

  try {
    const response = await channelsListerUseCase.execute(request.query);

    if (response) {
      return sendResponse(reply, {
        message: t('channels_list_successfully'),
        httpStatusCode: EHTTPStatusCode.ok,
        data: response,
      });
    }

    return sendResponse(reply, {
      message: t('channels_list_not_found'),
      httpStatusCode: EHTTPStatusCode.bad_request,
    });
  } catch (error) {
    handleControllerError(error, reply, t);
  }
};
