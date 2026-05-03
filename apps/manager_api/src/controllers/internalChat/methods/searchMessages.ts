import { FastifyReply, FastifyRequest } from 'fastify';
import { container } from 'tsyringe';
import { EHTTPStatusCode } from '@core/common/enums/EHTTPStatusCode';
import { sendResponse } from '@core/common/functions/sendResponse';
import {
  SearchInternalChatMessagesParams,
  SearchInternalChatMessagesQuery,
} from '@core/schema/internalChat/searchMessages/request.schema';
import { InternalChatMessageSearcherUseCase } from '@core/useCases/internalChat/InternalChatMessageSearcher.useCase';
import { handleInternalChatError } from '@core/common/functions/handleInternalChatError';

export const searchMessages = async (
  request: FastifyRequest<{
    Params: SearchInternalChatMessagesParams;
    Querystring: SearchInternalChatMessagesQuery;
  }>,
  reply: FastifyReply
) => {
  const useCase = container.resolve(InternalChatMessageSearcherUseCase);
  const { tokenJwtData, t } = request;

  try {
    const response = await useCase.execute(
      tokenJwtData.account_id,
      tokenJwtData.user_id,
      request.params.conversation_id,
      request.query
    );

    return sendResponse(reply, {
      message: t('messages_search_success'),
      httpStatusCode: EHTTPStatusCode.ok,
      data: response,
    });
  } catch (error) {
    handleInternalChatError(error, reply, t);
  }
};
