import { EHTTPStatusCode } from '@core/common/enums/EHTTPStatusCode';
import { sendResponse } from '@core/common/functions/sendResponse';
import { FastifyReply, FastifyRequest } from 'fastify';
import { container } from 'tsyringe';
import { UpdateChatsUserRequest } from '@core/schema/chat/updateChatsUser/request.schema';
import { ChatUserUpdaterUseCase } from '@core/useCases/chat/ChatUserUpdater.useCase';

export const updateChatsUser = async (
  request: FastifyRequest<{
    Body: UpdateChatsUserRequest;
  }>,
  reply: FastifyReply
) => {
  const chatUserUpdaterUseCase = container.resolve(ChatUserUpdaterUseCase);
  const { t, tokenJwtData } = request;

  try {
    const response = await chatUserUpdaterUseCase.execute(
      t,
      tokenJwtData.user_id,
      request.body
    );

    if (response) {
      return sendResponse(reply, {
        message: t('chat_update_user_success'),
        httpStatusCode: EHTTPStatusCode.ok,
      });
    }

    request.server.logger.info(response, request.id);

    return sendResponse(reply, {
      message: t('chat_update_user_not_found'),
      httpStatusCode: EHTTPStatusCode.bad_request,
    });
  } catch (error) {
    request.server.logger.error(error, request.id);

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
