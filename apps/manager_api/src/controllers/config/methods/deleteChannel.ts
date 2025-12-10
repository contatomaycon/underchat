import { EHTTPStatusCode } from '@core/common/enums/EHTTPStatusCode';
import { sendResponse } from '@core/common/functions/sendResponse';
import { FastifyReply, FastifyRequest } from 'fastify';
import { container } from 'tsyringe';
import { ChannelDeleterUseCase } from '@core/useCases/config/ChannelDeleter.useCase';
import { DeleteChannelRequest } from '@core/schema/config/deleteChannel/request.schema';

export const deleteChannel = async (
  request: FastifyRequest<{
    Params: DeleteChannelRequest;
  }>,
  reply: FastifyReply
) => {
  const channelDeleterUseCase = container.resolve(ChannelDeleterUseCase);
  const { t } = request;

  try {
    const response = await channelDeleterUseCase.execute(
      t,
      request.params.channel_id
    );

    if (response) {
      return sendResponse(reply, {
        message: t('channel_delete_success'),
        httpStatusCode: EHTTPStatusCode.ok,
      });
    }

    return sendResponse(reply, {
      message: t('channel_delete_error'),
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
