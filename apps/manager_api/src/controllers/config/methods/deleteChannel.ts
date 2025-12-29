import { EHTTPStatusCode } from '@core/common/enums/EHTTPStatusCode';
import { sendResponse } from '@core/common/functions/sendResponse';
import { handleControllerError } from '@core/common/functions/handleControllerError';
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
    handleControllerError(error, reply, t);
  }
};
