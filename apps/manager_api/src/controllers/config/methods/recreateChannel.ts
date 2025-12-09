import { EHTTPStatusCode } from '@core/common/enums/EHTTPStatusCode';
import { sendResponse } from '@core/common/functions/sendResponse';
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
