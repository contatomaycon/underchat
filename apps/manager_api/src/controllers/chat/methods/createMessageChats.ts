import { EHTTPStatusCode } from '@core/common/enums/EHTTPStatusCode';
import { sendResponse } from '@core/common/functions/sendResponse';
import { handleControllerError } from '@core/common/functions/handleControllerError';
import { FastifyReply, FastifyRequest } from 'fastify';
import { container } from 'tsyringe';
import {
  CreateMessageChatsBody,
  CreateMessageChatsParams,
} from '@core/schema/chat/createMessageChats/request.schema';
import { ChatMessageCreatorUseCase } from '@core/useCases/chat/ChatMessageCreator.useCase';
import { ETypeUserChat } from '@core/common/enums/ETypeUserChat';

export const createMessageChats = async (
  request: FastifyRequest<{
    Params: CreateMessageChatsParams;
    Body: CreateMessageChatsBody;
  }>,
  reply: FastifyReply
) => {
  const chatMessageCreatorUseCase = container.resolve(
    ChatMessageCreatorUseCase
  );
  const { t, tokenJwtData } = request;

  try {
    const response = await chatMessageCreatorUseCase.execute(
      t,
      tokenJwtData.account_id,
      request.params,
      request.body,
      ETypeUserChat.operator,
      tokenJwtData.user_id,
      tokenJwtData.actions,
      tokenJwtData.sectors
    );

    if (response) {
      return sendResponse(reply, {
        message: t('chat_create_success'),
        httpStatusCode: EHTTPStatusCode.ok,
        data: response,
      });
    }

    return sendResponse(reply, {
      message: t('chat_create_not_found'),
      httpStatusCode: EHTTPStatusCode.bad_request,
    });
  } catch (error) {
    handleControllerError(error, reply, t);
  }
};
