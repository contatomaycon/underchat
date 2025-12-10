import { EHTTPStatusCode } from '@core/common/enums/EHTTPStatusCode';
import { sendResponse } from '@core/common/functions/sendResponse';
import { FastifyReply, FastifyRequest } from 'fastify';
import { container } from 'tsyringe';
import { ChatMessageListerUseCase } from '@core/useCases/chat/ChatMessageLister.useCase';
import {
  ListMessageChatsParams,
  ListMessageChatsQuery,
} from '@core/schema/chat/listMessageChats/request.schema';

export const listMessageChats = async (
  request: FastifyRequest<{
    Querystring: ListMessageChatsQuery;
    Params: ListMessageChatsParams;
  }>,
  reply: FastifyReply
) => {
  const chatMessageListerUseCase = container.resolve(ChatMessageListerUseCase);
  const { t, tokenJwtData } = request;

  try {
    const response = await chatMessageListerUseCase.execute(
      t,
      tokenJwtData.account_id,
      request.query,
      request.params,
      tokenJwtData.user_id,
      tokenJwtData.actions
    );

    if (response) {
      return sendResponse(reply, {
        message: t('chat_list_success'),
        httpStatusCode: EHTTPStatusCode.ok,
        data: response,
      });
    }

    return sendResponse(reply, {
      message: t('chat_list_not_found'),
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
