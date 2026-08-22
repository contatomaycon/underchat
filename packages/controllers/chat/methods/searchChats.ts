import { EHTTPStatusCode } from '@core/common/enums/EHTTPStatusCode';
import { sendResponse } from '@core/common/functions/sendResponse';
import { handleControllerError } from '@core/common/functions/handleControllerError';
import type { FastifyReply, FastifyRequest } from 'fastify';
import { container } from 'tsyringe';
import { SearchChatsQuery } from '@core/schema/chat/searchChats/request.schema';
import { ChatSearcherUseCase } from '@core/useCases/chat/ChatSearcher.useCase';

export const searchChats = async (
  request: FastifyRequest<{
    Querystring: SearchChatsQuery;
  }>,
  reply: FastifyReply
) => {
  const chatSearcherUseCase = container.resolve(ChatSearcherUseCase);
  const { t, tokenJwtData } = request;

  try {
    const response = await chatSearcherUseCase.execute(
      tokenJwtData.account_id,
      request.query,
      tokenJwtData.user_id,
      tokenJwtData.actions,
      tokenJwtData.sectors,
      tokenJwtData.channels
    );

    return sendResponse(reply, {
      message: t('chats_search_success'),
      httpStatusCode: EHTTPStatusCode.ok,
      data: response,
    });
  } catch (error) {
    handleControllerError(error, reply, t);
  }
};
