import { EHTTPStatusCode } from '@core/common/enums/EHTTPStatusCode';
import { sendResponse } from '@core/common/functions/sendResponse';
import { handleControllerError } from '@core/common/functions/handleControllerError';
import { FastifyReply, FastifyRequest } from 'fastify';
import { container } from 'tsyringe';
import { ChatMessageCreatorUseCase } from '@core/useCases/chat/ChatMessageCreator.useCase';
import {
  ReactMessageParams,
  ReactMessageBody,
} from '@core/schema/chat/reactMessage/request.schema';
import {
  CreateMessageChatsParams,
  CreateMessageChatsBody,
} from '@core/schema/chat/createMessageChats/request.schema';
import { ETypeUserChat } from '@core/common/enums/ETypeUserChat';

export const reactMessage = async (
  request: FastifyRequest<{
    Params: ReactMessageParams;
    Body: ReactMessageBody;
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
      type: 'react' as any,
      reaction_message_id: request.params.message_id,
      reaction_emoji: request.body.emoji,
    };

    const response = await chatMessageCreatorUseCase.execute(
      t,
      tokenJwtData.account_id,
      params,
      body,
      ETypeUserChat.operator,
      tokenJwtData.user_id,
      tokenJwtData.actions
    );

    if (response) {
      return sendResponse(reply, {
        message: t('chat_reaction_success'),
        httpStatusCode: EHTTPStatusCode.ok,
        data: response,
      });
    }

    return sendResponse(reply, {
      message: t('chat_reaction_error'),
      httpStatusCode: EHTTPStatusCode.bad_request,
    });
  } catch (error) {
    handleControllerError(error, reply, t);
  }
};
