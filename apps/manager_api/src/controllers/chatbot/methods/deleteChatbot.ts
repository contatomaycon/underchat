import { EHTTPStatusCode } from '@core/common/enums/EHTTPStatusCode';
import { sendResponse } from '@core/common/functions/sendResponse';
import { FastifyReply, FastifyRequest } from 'fastify';
import { container } from 'tsyringe';
import { DeleteChatbotRequest } from '@core/schema/chatbot/deleteChatbot/request.schema';
import { ChatbotDeleterUseCase } from '@core/useCases/chatbot/ChatbotDeleter.useCase';

export const deleteChatbot = async (
  request: FastifyRequest<{
    Params: DeleteChatbotRequest;
  }>,
  reply: FastifyReply
) => {
  const chatbotDeleterUseCase = container.resolve(ChatbotDeleterUseCase);
  const { t, tokenJwtData } = request;

  try {
    const response = await chatbotDeleterUseCase.execute(
      t,
      request.params.chatbot_id,
      tokenJwtData.account_id
    );

    if (response) {
      return sendResponse(reply, {
        message: t('chatbot_deleted_successfully'),
        httpStatusCode: EHTTPStatusCode.ok,
      });
    }

    request.server.logger.info(response, request.id);

    return sendResponse(reply, {
      message: t('chatbot_deleter_error'),
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
