import { EHTTPStatusCode } from '@core/common/enums/EHTTPStatusCode';
import { sendResponse } from '@core/common/functions/sendResponse';
import { FastifyReply, FastifyRequest } from 'fastify';
import { container } from 'tsyringe';
import { ChatboxChatTagsListerUseCase } from '@core/useCases/chatbox/ChatboxChatTagsLister.useCase';

export const listChatTags = async (
  request: FastifyRequest,
  reply: FastifyReply
) => {
  const chatboxChatTagsListerUseCase = container.resolve(
    ChatboxChatTagsListerUseCase
  );
  const { t, tokenJwtData } = request;

  try {
    const response = await chatboxChatTagsListerUseCase.execute(
      tokenJwtData.account_id
    );

    return sendResponse(reply, {
      message: t('chatbox_chat_tags_listed_successfully'),
      httpStatusCode: EHTTPStatusCode.ok,
      data: response,
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
