import { EHTTPStatusCode } from '@core/common/enums/EHTTPStatusCode';
import { sendResponse } from '@core/common/functions/sendResponse';
import { FastifyReply, FastifyRequest } from 'fastify';
import { container } from 'tsyringe';
import { CreateChatRequest } from '@core/schema/chat/createChat/request.schema';
import { ChatCreatorUseCase } from '@core/useCases/chat/ChatCreator.useCase';

export const createChats = async (
  request: FastifyRequest<{
    Body: CreateChatRequest;
  }>,
  reply: FastifyReply
) => {
  const chatCreatorUseCase = container.resolve(ChatCreatorUseCase);
  const { t, tokenJwtData } = request;

  try {
    const response = await chatCreatorUseCase.execute(
      t,
      tokenJwtData.account_id,
      tokenJwtData.user_id,
      request.body
    );

    if (response) {
      return sendResponse(reply, {
        message: t('chat_create_success'),
        httpStatusCode: EHTTPStatusCode.ok,
        data: response,
      });
    }

    request.server.logger.info(response, request.id);

    return sendResponse(reply, {
      message: t('chat_create_not_found'),
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
