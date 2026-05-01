import { FastifyReply, FastifyRequest } from 'fastify';
import { container } from 'tsyringe';
import { EHTTPStatusCode } from '@core/common/enums/EHTTPStatusCode';
import { sendResponse } from '@core/common/functions/sendResponse';
import {
  CreateMessageBody,
  CreateMessageParams,
} from '@core/schema/internalChat/createMessage/request.schema';
import { InternalChatMessageCreatorUseCase } from '@core/useCases/internalChat/InternalChatMessageCreator.useCase';
import { handleInternalChatError } from '@core/common/functions/handleInternalChatError';

export const createMessage = async (
  request: FastifyRequest<{
    Params: CreateMessageParams;
    Body: CreateMessageBody;
  }>,
  reply: FastifyReply
) => {
  const useCase = container.resolve(InternalChatMessageCreatorUseCase);
  const { tokenJwtData, t } = request;

  try {
    const response = await useCase.execute(
      tokenJwtData.account_id,
      tokenJwtData.user_id,
      request.params.conversation_id,
      request.body
    );

    return sendResponse(reply, {
      message: t('chat_create_success'),
      httpStatusCode: EHTTPStatusCode.ok,
      data: response,
    });
  } catch (error) {
    handleInternalChatError(error, reply, t);
  }
};
