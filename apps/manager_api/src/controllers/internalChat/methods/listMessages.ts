import { FastifyReply, FastifyRequest } from 'fastify';
import { container } from 'tsyringe';
import { EHTTPStatusCode } from '@core/common/enums/EHTTPStatusCode';
import { sendResponse } from '@core/common/functions/sendResponse';
import {
  ListMessagesParams,
  ListMessagesQuery,
} from '@core/schema/internalChat/listMessages/request.schema';
import { InternalChatMessagesListerUseCase } from '@core/useCases/internalChat/InternalChatMessagesLister.useCase';
import { handleInternalChatError } from '@core/common/functions/handleInternalChatError';

export const listMessages = async (
  request: FastifyRequest<{
    Params: ListMessagesParams;
    Querystring: ListMessagesQuery;
  }>,
  reply: FastifyReply
) => {
  const useCase = container.resolve(InternalChatMessagesListerUseCase);
  const { tokenJwtData, t } = request;

  try {
    const response = await useCase.execute(
      tokenJwtData.account_id,
      tokenJwtData.user_id,
      request.params.conversation_id,
      request.query
    );

    return sendResponse(reply, {
      message: t('chat_list_success'),
      httpStatusCode: EHTTPStatusCode.ok,
      data: response,
    });
  } catch (error) {
    handleInternalChatError(error, reply, t);
  }
};
