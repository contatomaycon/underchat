import { EHTTPStatusCode } from '@core/common/enums/EHTTPStatusCode';
import { sendResponse } from '@core/common/functions/sendResponse';
import { FastifyReply, FastifyRequest } from 'fastify';
import { container } from 'tsyringe';
import {
  CreateMessageChatsBody,
  CreateMessageChatsParams,
} from '@core/schema/chat/createMessageChats/request.schema';
import { ChatMessageCreatorUseCase } from '@core/useCases/chat/ChatMessageCreator.useCase';

export const createMessageChats = async (
  request: FastifyRequest<{
    Params: CreateMessageChatsParams;
    Body: CreateMessageChatsBody & {
      images?: any[];
    };
  }>,
  reply: FastifyReply
) => {
  const chatMessageCreatorUseCase = container.resolve(
    ChatMessageCreatorUseCase
  );
  const { t, tokenJwtData } = request;

  try {
    const images = Array.isArray(request.body.images)
      ? request.body.images
      : request.body.images
        ? [request.body.images]
        : [];

    const body = {
      ...request.body,
      images,
    };

    const response = await chatMessageCreatorUseCase.execute(
      t,
      tokenJwtData.account_id,
      request.params,
      body
    );

    if (response) {
      return sendResponse(reply, {
        message: t('chat_create_success'),
        httpStatusCode: EHTTPStatusCode.ok,
        data: response,
      });
    }

    request.server.logger.info(response, request.id);

    return sendResponse(reply, {
      message: t('chat_create_not_found'),
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
