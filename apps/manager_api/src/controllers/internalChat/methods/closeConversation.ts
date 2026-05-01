import { FastifyReply, FastifyRequest } from 'fastify';
import { container } from 'tsyringe';
import { EHTTPStatusCode } from '@core/common/enums/EHTTPStatusCode';
import { sendResponse } from '@core/common/functions/sendResponse';
import { CloseConversationParams } from '@core/schema/internalChat/closeConversation/request.schema';
import { InternalChatConversationCloserUseCase } from '@core/useCases/internalChat/InternalChatConversationCloser.useCase';
import { handleInternalChatError } from '@core/common/functions/handleInternalChatError';

export const closeConversation = async (
  request: FastifyRequest<{ Params: CloseConversationParams }>,
  reply: FastifyReply
) => {
  const useCase = container.resolve(InternalChatConversationCloserUseCase);
  const { tokenJwtData, t } = request;

  try {
    const response = await useCase.execute(
      tokenJwtData.account_id,
      tokenJwtData.user_id,
      request.params.conversation_id
    );

    return sendResponse(reply, {
      message: t('chat_close_success'),
      httpStatusCode: EHTTPStatusCode.ok,
      data: response ? null : null,
    });
  } catch (error) {
    handleInternalChatError(error, reply, t);
  }
};
