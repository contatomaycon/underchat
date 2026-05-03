import { FastifyReply, FastifyRequest } from 'fastify';
import { container } from 'tsyringe';
import { EHTTPStatusCode } from '@core/common/enums/EHTTPStatusCode';
import { sendResponse } from '@core/common/functions/sendResponse';
import { MessageHistoryParams } from '@core/schema/internalChat/messageHistory/request.schema';
import { InternalChatMessageHistoryViewerUseCase } from '@core/useCases/internalChat/InternalChatMessageHistoryViewer.useCase';
import { handleInternalChatError } from '@core/common/functions/handleInternalChatError';

export const viewMessageHistory = async (
  request: FastifyRequest<{ Params: MessageHistoryParams }>,
  reply: FastifyReply
) => {
  const useCase = container.resolve(InternalChatMessageHistoryViewerUseCase);
  const { tokenJwtData, t } = request;

  try {
    const response = await useCase.execute(
      tokenJwtData.account_id,
      tokenJwtData.user_id,
      request.params.conversation_id,
      request.params.message_id
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
