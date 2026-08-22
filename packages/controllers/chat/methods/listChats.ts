import { EHTTPStatusCode } from '@core/common/enums/EHTTPStatusCode';
import { sendResponse } from '@core/common/functions/sendResponse';
import { handleControllerError } from '@core/common/functions/handleControllerError';
import type { FastifyReply, FastifyRequest } from 'fastify';
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
      request.query,
      tokenJwtData.user_id,
      tokenJwtData.actions,
      tokenJwtData.sectors,
      tokenJwtData.channels
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
    handleControllerError(error, reply, t);
  }
};
