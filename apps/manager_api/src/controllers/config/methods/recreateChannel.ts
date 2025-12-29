import { EHTTPStatusCode } from '@core/common/enums/EHTTPStatusCode';
import { sendResponse } from '@core/common/functions/sendResponse';
import { handleControllerError } from '@core/common/functions/handleControllerError';
import { FastifyReply, FastifyRequest } from 'fastify';
import { container } from 'tsyringe';
import { ChannelRecreatorUseCase } from '@core/useCases/config/ChannelRecreator.useCase';
import { RecreateChannelRequest } from '@core/schema/config/recreateChannel/request.schema';

export const recreateChannel = async (
  request: FastifyRequest<{
    Params: RecreateChannelRequest;
  }>,
  reply: FastifyReply
) => {
  const channelRecreatorUseCase = container.resolve(ChannelRecreatorUseCase);
  const { t } = request;

  try {
    const response = await channelRecreatorUseCase.execute(
      t,
      request.params.channel_id
    );

    if (response) {
      return sendResponse(reply, {
        message: t('channel_recreate_success'),
        httpStatusCode: EHTTPStatusCode.ok,
      });
    }

    return sendResponse(reply, {
      message: t('channel_recreate_error'),
      httpStatusCode: EHTTPStatusCode.bad_request,
    });
  } catch (error) {
    handleControllerError(error, reply, t);
  }
};
