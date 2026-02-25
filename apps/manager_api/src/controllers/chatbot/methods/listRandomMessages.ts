import { EHTTPStatusCode } from '@core/common/enums/EHTTPStatusCode';
import { sendResponse } from '@core/common/functions/sendResponse';
import { handleControllerError } from '@core/common/functions/handleControllerError';
import { FastifyReply, FastifyRequest } from 'fastify';
import { container } from 'tsyringe';
import { ChatbotRandomMessagesListerUseCase } from '@core/useCases/chatbot/ChatbotRandomMessagesLister.useCase';

export const listRandomMessages = async (
  request: FastifyRequest,
  reply: FastifyReply
) => {
  const chatbotRandomMessagesListerUseCase = container.resolve(
    ChatbotRandomMessagesListerUseCase
  );
  const { t, tokenJwtData } = request;

  try {
    const response = await chatbotRandomMessagesListerUseCase.execute(
      tokenJwtData.account_id
    );

    return sendResponse(reply, {
      message: t('chatbot_random_messages_listed_successfully'),
      httpStatusCode: EHTTPStatusCode.ok,
      data: response,
    });
  } catch (error) {
    handleControllerError(error, reply, t);
  }
};
