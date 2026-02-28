import { EHTTPStatusCode } from '@core/common/enums/EHTTPStatusCode';
import { sendResponse } from '@core/common/functions/sendResponse';
import { handleControllerError } from '@core/common/functions/handleControllerError';
import { FastifyReply, FastifyRequest } from 'fastify';
import { container } from 'tsyringe';
import {
  ForwardMessageBody,
  ForwardMessageParams,
} from '@core/schema/chat/forwardMessage/request.schema';
import { ChatMessageForwarderUseCase } from '@core/useCases/chat/ChatMessageForwarder.useCase';

export const forwardMessage = async (
  request: FastifyRequest<{
    Params: ForwardMessageParams;
    Body: ForwardMessageBody;
  }>,
  reply: FastifyReply
) => {
  const chatMessageForwarderUseCase = container.resolve(
    ChatMessageForwarderUseCase
  );
  const { t, tokenJwtData } = request;

  try {
    const response = await chatMessageForwarderUseCase.execute(
      t,
      tokenJwtData.account_id,
      request.params,
      request.body,
      tokenJwtData.user_id,
      tokenJwtData.actions,
      tokenJwtData.sectors,
      tokenJwtData.channels
    );

    const hasPartialFailure = response.failed > 0;
    const message = hasPartialFailure
      ? t('chat_forward_partial_success', {
          sent: response.sent,
          failed: response.failed,
        })
      : t('chat_forward_success');

    return sendResponse(reply, {
      message,
      httpStatusCode: EHTTPStatusCode.ok,
      data: response,
    });
  } catch (error) {
    if (error instanceof Error) {
      return sendResponse(reply, {
        message: error.message,
        httpStatusCode: EHTTPStatusCode.bad_request,
      });
    }

    handleControllerError(error, reply, t);
  }
};
