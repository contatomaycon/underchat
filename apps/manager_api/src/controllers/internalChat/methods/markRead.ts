import { FastifyReply, FastifyRequest } from 'fastify';
import { container } from 'tsyringe';
import { EHTTPStatusCode } from '@core/common/enums/EHTTPStatusCode';
import { sendResponse } from '@core/common/functions/sendResponse';
import {
  MarkReadBody,
  MarkReadParams,
} from '@core/schema/internalChat/markRead/request.schema';
import { InternalChatConversationMarkReadUseCase } from '@core/useCases/internalChat/InternalChatConversationMarkRead.useCase';
import { handleInternalChatError } from '@core/common/functions/handleInternalChatError';

export const markRead = async (
  request: FastifyRequest<{ Params: MarkReadParams; Body: MarkReadBody }>,
  reply: FastifyReply
) => {
  const useCase = container.resolve(InternalChatConversationMarkReadUseCase);
  const { tokenJwtData, t } = request;

  try {
    const response = await useCase.execute(
      tokenJwtData.account_id,
      tokenJwtData.user_id,
      request.params.conversation_id,
      request.body
    );

    return sendResponse(reply, {
      message: t('chat_update_success'),
      httpStatusCode: EHTTPStatusCode.ok,
      data: response ? null : null,
    });
  } catch (error) {
    handleInternalChatError(error, reply, t);
  }
};
