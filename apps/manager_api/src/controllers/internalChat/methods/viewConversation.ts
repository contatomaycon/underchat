import { FastifyReply, FastifyRequest } from 'fastify';
import { container } from 'tsyringe';
import { EHTTPStatusCode } from '@core/common/enums/EHTTPStatusCode';
import { sendResponse } from '@core/common/functions/sendResponse';
import { ViewConversationParams } from '@core/schema/internalChat/viewConversation/request.schema';
import { InternalChatConversationViewerUseCase } from '@core/useCases/internalChat/InternalChatConversationViewer.useCase';
import { handleInternalChatError } from '@core/common/functions/handleInternalChatError';

export const viewConversation = async (
  request: FastifyRequest<{ Params: ViewConversationParams }>,
  reply: FastifyReply
) => {
  const useCase = container.resolve(InternalChatConversationViewerUseCase);
  const { tokenJwtData, t } = request;

  try {
    const response = await useCase.execute(
      tokenJwtData.account_id,
      tokenJwtData.user_id,
      request.params.conversation_id
    );

    return sendResponse(reply, {
      message: t('chat_view_success'),
      httpStatusCode: EHTTPStatusCode.ok,
      data: response,
    });
  } catch (error) {
    handleInternalChatError(error, reply, t);
  }
};
