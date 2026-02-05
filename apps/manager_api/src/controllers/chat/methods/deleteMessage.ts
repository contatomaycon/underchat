import { EHTTPStatusCode } from '@core/common/enums/EHTTPStatusCode';
import { sendResponse } from '@core/common/functions/sendResponse';
import { handleControllerError } from '@core/common/functions/handleControllerError';
import { FastifyReply, FastifyRequest } from 'fastify';
import { container } from 'tsyringe';
import { ChatMessageCreatorUseCase } from '@core/useCases/chat/ChatMessageCreator.useCase';
import { DeleteMessageParams } from '@core/schema/chat/deleteMessage/request.schema';
import {
  CreateMessageChatsBody,
  CreateMessageChatsParams,
} from '@core/schema/chat/createMessageChats/request.schema';
import { ETypeUserChat } from '@core/common/enums/ETypeUserChat';

export const deleteMessage = async (
  request: FastifyRequest<{
    Params: DeleteMessageParams;
  }>,
  reply: FastifyReply
) => {
  const chatMessageCreatorUseCase = container.resolve(
    ChatMessageCreatorUseCase
  );
  const { t, tokenJwtData } = request;

  try {
    const params: CreateMessageChatsParams = {
      chat_id: request.params.chat_id,
    };

    const body: CreateMessageChatsBody = {
      type: 'delete_message' as any,
      delete_message_id: request.params.message_id,
    };

    const response = await chatMessageCreatorUseCase.execute(
      t,
      tokenJwtData.account_id,
      params,
      body,
      ETypeUserChat.operator,
      tokenJwtData.user_id,
      tokenJwtData.actions,
      tokenJwtData.sectors
    );

    if (response) {
      return sendResponse(reply, {
        message: t('chat_delete_success'),
        httpStatusCode: EHTTPStatusCode.ok,
        data: response,
      });
    }

    return sendResponse(reply, {
      message: t('chat_delete_error'),
      httpStatusCode: EHTTPStatusCode.bad_request,
    });
  } catch (error) {
    handleControllerError(error, reply, t);
  }
};
