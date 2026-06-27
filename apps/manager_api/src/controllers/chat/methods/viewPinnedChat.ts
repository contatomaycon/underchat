import { EHTTPStatusCode } from '@core/common/enums/EHTTPStatusCode';
import { sendResponse } from '@core/common/functions/sendResponse';
import { handleControllerError } from '@core/common/functions/handleControllerError';
import { FastifyReply, FastifyRequest } from 'fastify';
import { container } from 'tsyringe';
import { ChatPinnedViewerUseCase } from '@core/useCases/chat/ChatPinnedViewer.useCase';

export const viewPinnedChat = async (
  request: FastifyRequest,
  reply: FastifyReply
) => {
  const chatPinnedViewerUseCase = container.resolve(ChatPinnedViewerUseCase);
  const { t, tokenJwtData } = request;

  try {
    const response = await chatPinnedViewerUseCase.execute(
      tokenJwtData.account_id,
      tokenJwtData.user_id,
      tokenJwtData.actions,
      tokenJwtData.sectors,
      tokenJwtData.channels
    );

    return sendResponse(reply, {
      message: t('chat_view_pinned_success'),
      httpStatusCode: EHTTPStatusCode.ok,
      data: response,
    });
  } catch (error) {
    handleControllerError(error, reply, t);
  }
};
