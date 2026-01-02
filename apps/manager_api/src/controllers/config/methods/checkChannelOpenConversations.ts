import { EHTTPStatusCode } from '@core/common/enums/EHTTPStatusCode';
import { sendResponse } from '@core/common/functions/sendResponse';
import { handleControllerError } from '@core/common/functions/handleControllerError';
import { FastifyReply, FastifyRequest } from 'fastify';
import { container } from 'tsyringe';
import { ChannelOpenConversationsCheckerUseCase } from '@core/useCases/config/ChannelOpenConversationsChecker.useCase';
import { CheckChannelOpenConversationsRequest } from '@core/schema/config/checkChannelOpenConversations/request.schema';

export const checkChannelOpenConversations = async (
  request: FastifyRequest<{
    Params: CheckChannelOpenConversationsRequest;
  }>,
  reply: FastifyReply
) => {
  const channelOpenConversationsCheckerUseCase = container.resolve(
    ChannelOpenConversationsCheckerUseCase
  );
  const { t } = request;

  try {
    const count = await channelOpenConversationsCheckerUseCase.execute(
      t,
      request.params.channel_id
    );

    return sendResponse(reply, {
      message: t('channel_open_conversations_check_success'),
      httpStatusCode: EHTTPStatusCode.ok,
      data: { count },
    });
  } catch (error) {
    handleControllerError(error, reply, t);
  }
};
