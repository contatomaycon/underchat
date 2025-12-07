import { EHTTPStatusCode } from '@core/common/enums/EHTTPStatusCode';
import { sendResponse } from '@core/common/functions/sendResponse';
import { FastifyReply, FastifyRequest } from 'fastify';
import { container } from 'tsyringe';
import {
  UpdateChatbotRequest,
  UpdateChatbotParamsRequest,
} from '@core/schema/chatbot/updateChatbot/request.schema';
import { ChatbotUpdaterUseCase } from '@core/useCases/chatbot/ChatbotUpdater.useCase';

export const updateChatbot = async (
  request: FastifyRequest<{
    Body: UpdateChatbotRequest;
    Params: UpdateChatbotParamsRequest;
  }>,
  reply: FastifyReply
) => {
  const chatbotUpdaterUseCase = container.resolve(ChatbotUpdaterUseCase);
  const { t, tokenJwtData } = request;

  try {
    const response = await chatbotUpdaterUseCase.execute(
      t,
      request.params.chatbot_id,
      request.body,
      tokenJwtData.account_id
    );

    if (response) {
      return sendResponse(reply, {
        message: t('chatbot_update_success'),
        httpStatusCode: EHTTPStatusCode.ok,
        data: response,
      });
    }


    return sendResponse(reply, {
      message: t('chatbot_update_error'),
      httpStatusCode: EHTTPStatusCode.bad_request,
    });
  } catch (error) {
    console.error(error);

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
