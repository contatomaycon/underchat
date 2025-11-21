import { EHTTPStatusCode } from '@core/common/enums/EHTTPStatusCode';
import { sendResponse } from '@core/common/functions/sendResponse';
import { FastifyReply, FastifyRequest } from 'fastify';
import { container } from 'tsyringe';
import { ChatMessageCreatorUseCase } from '@core/useCases/chat/ChatMessageCreator.useCase';
import { DeleteMessageParams } from '@core/schema/chat/deleteMessage/request.schema';
import {
  CreateMessageChatsBody,
  CreateMessageChatsParams,
} from '@core/schema/chat/createMessageChats/request.schema';

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
      body
    );

    if (response) {
      return sendResponse(reply, {
        message: t('chat_delete_success'),
        httpStatusCode: EHTTPStatusCode.ok,
        data: response,
      });
    }

    request.server.logger.info(response, request.id);

    return sendResponse(reply, {
      message: t('chat_delete_error'),
      httpStatusCode: EHTTPStatusCode.bad_request,
    });
  } catch (error) {
    request.server.logger.error(error, request.id);

    if (error instanceof Error) {
      return sendResponse(reply, {
        message: error.message,
        httpStatusCode: EHTTPStatusCode.internal_server_error,
      });
    }

    return sendResponse(reply, {
      message: t('internal_server_error'),
      httpStatusCode: EHTTPStatusCode.internal_server_error,
    });
  }
};
