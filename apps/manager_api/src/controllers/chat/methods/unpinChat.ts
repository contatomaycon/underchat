import { EHTTPStatusCode } from '@core/common/enums/EHTTPStatusCode';
import { sendResponse } from '@core/common/functions/sendResponse';
import { handleControllerError } from '@core/common/functions/handleControllerError';
import { FastifyReply, FastifyRequest } from 'fastify';
import { container } from 'tsyringe';
import { ChatUnpinnerUseCase } from '@core/useCases/chat/ChatUnpinner.useCase';

export const unpinChat = async (
  request: FastifyRequest<{
    Params: {
      chat_id: string;
    };
  }>,
  reply: FastifyReply
) => {
  const chatUnpinnerUseCase = container.resolve(ChatUnpinnerUseCase);
  const { t, tokenJwtData } = request;

  try {
    await chatUnpinnerUseCase.execute(tokenJwtData.user_id, request.params.chat_id);

    return sendResponse(reply, {
      message: t('chat_unpin_success'),
      httpStatusCode: EHTTPStatusCode.ok,
    });
  } catch (error) {
    handleControllerError(error, reply, t);
  }
};
