import { EHTTPStatusCode } from '@core/common/enums/EHTTPStatusCode';
import { sendResponse } from '@core/common/functions/sendResponse';
import { FastifyReply, FastifyRequest } from 'fastify';
import { container } from 'tsyringe';
import { ListChatsQuery } from '@core/schema/chat/listChats/request.schema';
import { ChatListerUseCase } from '@core/useCases/chat/ChatLister.useCase';

export const listChats = async (
  request: FastifyRequest<{
    Querystring: ListChatsQuery;
  }>,
  reply: FastifyReply
) => {
  const chatListerUseCase = container.resolve(ChatListerUseCase);
  const { t, tokenJwtData } = request;

  try {
    const response = await chatListerUseCase.execute(
      tokenJwtData.account_id,
      request.query
    );

    if (response) {
      return sendResponse(reply, {
        message: t('chat_list_success'),
        httpStatusCode: EHTTPStatusCode.ok,
        data: response,
      });
    }

    request.server.logger.info(response, request.id);

    return sendResponse(reply, {
      message: t('chat_list_not_found'),
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
