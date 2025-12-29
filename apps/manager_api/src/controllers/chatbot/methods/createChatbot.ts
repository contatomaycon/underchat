import { EHTTPStatusCode } from '@core/common/enums/EHTTPStatusCode';
import { sendResponse } from '@core/common/functions/sendResponse';
import { handleControllerError } from '@core/common/functions/handleControllerError';
import { FastifyReply, FastifyRequest } from 'fastify';
import { container } from 'tsyringe';
import { CreateChatbotRequest } from '@core/schema/chatbot/createChatbot/request.schema';
import { ChatbotCreatorUseCase } from '@core/useCases/chatbot/ChatbotCreator.useCase';

export const createChatbot = async (
  request: FastifyRequest<{
    Body: CreateChatbotRequest;
  }>,
  reply: FastifyReply
) => {
  const chatbotCreatorUseCase = container.resolve(ChatbotCreatorUseCase);
  const { t, tokenJwtData } = request;

  try {
    const accountIdToUse = tokenJwtData.account_id;

    const response = await chatbotCreatorUseCase.execute(
      t,
      request.body,
      accountIdToUse
    );

    if (response) {
      return sendResponse(reply, {
        message: t('chatbot_creator_success'),
        httpStatusCode: EHTTPStatusCode.ok,
        data: response,
      });
    }

    return sendResponse(reply, {
      message: t('chatbot_creator_error'),
      httpStatusCode: EHTTPStatusCode.bad_request,
    });
  } catch (error) {
    handleControllerError(error, reply, t);
  }
};
