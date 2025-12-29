import { EHTTPStatusCode } from '@core/common/enums/EHTTPStatusCode';
import { sendResponse } from '@core/common/functions/sendResponse';
import { handleControllerError } from '@core/common/functions/handleControllerError';
import { FastifyReply, FastifyRequest } from 'fastify';
import { container } from 'tsyringe';
import { ChatbotListerUseCase } from '@core/useCases/chatbot/ChatbotLister.useCase';

export const listChatbot = async (
  request: FastifyRequest,
  reply: FastifyReply
) => {
  const chatbotListerUseCase = container.resolve(ChatbotListerUseCase);
  const { t, tokenJwtData } = request;

  try {
    const response = await chatbotListerUseCase.execute(
      tokenJwtData.account_id
    );

    return sendResponse(reply, {
      message: t('chatbot_list_successfully'),
      httpStatusCode: EHTTPStatusCode.ok,
      data: response,
    });
  } catch (error) {
    handleControllerError(error, reply, t);
  }
};
