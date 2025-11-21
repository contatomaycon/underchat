import { EHTTPStatusCode } from '@core/common/enums/EHTTPStatusCode';
import { sendResponse } from '@core/common/functions/sendResponse';
import { FastifyReply, FastifyRequest } from 'fastify';
import { container } from 'tsyringe';
import { ChatUserViewerUseCase } from '@core/useCases/chat/ChatUserViewer.useCase';

export const listChatsUser = async (
  request: FastifyRequest,
  reply: FastifyReply
) => {
  const chatUserViewerUseCase = container.resolve(ChatUserViewerUseCase);
  const { t, tokenJwtData } = request;

  try {
    const response = await chatUserViewerUseCase.execute(
      t,
      tokenJwtData.user_id
    );

    if (response) {
      return sendResponse(reply, {
        message: t('chat_list_user_success'),
        httpStatusCode: EHTTPStatusCode.ok,
        data: response,
      });
    }

    request.server.logger.info(response, request.id);

    return sendResponse(reply, {
      message: t('chat_list_user_not_found'),
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
