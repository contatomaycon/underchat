import { EHTTPStatusCode } from '@core/common/enums/EHTTPStatusCode';
import { sendResponse } from '@core/common/functions/sendResponse';
import { handleControllerError } from '@core/common/functions/handleControllerError';
import { FastifyReply, FastifyRequest } from 'fastify';
import { container } from 'tsyringe';
import {
  SearchMessagesParams,
  SearchMessagesQuery,
} from '@core/schema/chat/searchMessages/request.schema';
import { ChatMessageSearcherUseCase } from '@core/useCases/chat/ChatMessageSearcher.useCase';

export const searchMessages = async (
  request: FastifyRequest<{
    Params: SearchMessagesParams;
    Querystring: SearchMessagesQuery;
  }>,
  reply: FastifyReply
) => {
  const chatMessageSearcherUseCase = container.resolve(
    ChatMessageSearcherUseCase
  );
  const { t, tokenJwtData } = request;

  try {
    const response = await chatMessageSearcherUseCase.execute(
      t,
      tokenJwtData.account_id,
      request.query,
      request.params,
      tokenJwtData.user_id,
      tokenJwtData.actions,
      tokenJwtData.sectors,
      tokenJwtData.channels
    );

    return sendResponse(reply, {
      message: t('messages_search_success'),
      httpStatusCode: EHTTPStatusCode.ok,
      data: response,
    });
  } catch (error) {
    if (error instanceof Error && error.message === t('chat_not_found')) {
      return sendResponse(reply, {
        message: error.message,
        httpStatusCode: EHTTPStatusCode.not_found,
      });
    }

    if (error instanceof Error && error.message === t('chat_access_denied')) {
      return sendResponse(reply, {
        message: error.message,
        httpStatusCode: EHTTPStatusCode.forbidden,
      });
    }

    handleControllerError(error, reply, t);
  }
};
