import { FastifyReply, FastifyRequest } from 'fastify';
import { container } from 'tsyringe';
import { EHTTPStatusCode } from '@core/common/enums/EHTTPStatusCode';
import { sendResponse } from '@core/common/functions/sendResponse';
import { ListConversationsQuery } from '@core/schema/internalChat/listConversations/request.schema';
import { InternalChatConversationsListerUseCase } from '@core/useCases/internalChat/InternalChatConversationsLister.useCase';
import { handleInternalChatError } from '@core/common/functions/handleInternalChatError';

export const listConversations = async (
  request: FastifyRequest<{ Querystring: ListConversationsQuery }>,
  reply: FastifyReply
) => {
  const useCase = container.resolve(InternalChatConversationsListerUseCase);
  const { tokenJwtData, t } = request;

  try {
    const response = await useCase.execute(
      tokenJwtData.account_id,
      tokenJwtData.user_id,
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
