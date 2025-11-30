import { EHTTPStatusCode } from '@core/common/enums/EHTTPStatusCode';
import { sendResponse } from '@core/common/functions/sendResponse';
import { FastifyReply, FastifyRequest } from 'fastify';
import { container } from 'tsyringe';
import { ChatbotChatTagsListerUseCase } from '@core/useCases/chatbot/ChatbotChatTagsLister.useCase';

export const listChatTags = async (
  request: FastifyRequest,
  reply: FastifyReply
) => {
  const chatbotChatTagsListerUseCase = container.resolve(
    ChatbotChatTagsListerUseCase
  );
  const { t, tokenJwtData } = request;

  try {
    const response = await chatbotChatTagsListerUseCase.execute(
      tokenJwtData.account_id
    );

    return sendResponse(reply, {
      message: t('chatbot_chat_tags_listed_successfully'),
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
