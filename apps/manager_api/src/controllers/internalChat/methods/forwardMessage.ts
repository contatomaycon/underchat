import { FastifyReply, FastifyRequest } from 'fastify';
import { container } from 'tsyringe';
import { EHTTPStatusCode } from '@core/common/enums/EHTTPStatusCode';
import { sendResponse } from '@core/common/functions/sendResponse';
import {
  ForwardMessageBody,
  ForwardMessageParams,
} from '@core/schema/internalChat/forwardMessage/request.schema';
import { InternalChatMessageForwarderUseCase } from '@core/useCases/internalChat/InternalChatMessageForwarder.useCase';
import { handleInternalChatError } from '@core/common/functions/handleInternalChatError';

export const forwardMessage = async (
  request: FastifyRequest<{
    Params: ForwardMessageParams;
    Body: ForwardMessageBody;
  }>,
  reply: FastifyReply
) => {
  const useCase = container.resolve(InternalChatMessageForwarderUseCase);
  const { tokenJwtData, t } = request;

  try {
    const response = await useCase.execute(
      tokenJwtData.account_id,
      tokenJwtData.user_id,
      request.params.conversation_id,
      request.params.message_id,
      request.body
    );

    return sendResponse(reply, {
      message: t('chat_forward_success'),
      httpStatusCode: EHTTPStatusCode.ok,
      data: response,
    });
  } catch (error) {
    handleInternalChatError(error, reply, t);
  }
};
