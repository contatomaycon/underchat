import { EHTTPStatusCode } from '@core/common/enums/EHTTPStatusCode';
import { sendResponse } from '@core/common/functions/sendResponse';
import { handleControllerError } from '@core/common/functions/handleControllerError';
import type { FastifyReply, FastifyRequest } from 'fastify';
import { container } from 'tsyringe';
import { ChatPinnerUseCase } from '@core/useCases/chat/ChatPinner.useCase';

export const pinChat = async (
  request: FastifyRequest<{
    Params: {
      chat_id: string;
    };
  }>,
  reply: FastifyReply
) => {
  const chatPinnerUseCase = container.resolve(ChatPinnerUseCase);
  const { t, tokenJwtData } = request;

  try {
    await chatPinnerUseCase.execute(
      t,
      tokenJwtData.account_id,
      tokenJwtData.user_id,
      tokenJwtData.actions,
      tokenJwtData.sectors,
      tokenJwtData.channels,
      request.params.chat_id
    );

    return sendResponse(reply, {
      message: t('chat_pin_success'),
      httpStatusCode: EHTTPStatusCode.ok,
    });
  } catch (error) {
    handleControllerError(error, reply, t);
  }
};
