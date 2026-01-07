import { EHTTPStatusCode } from '@core/common/enums/EHTTPStatusCode';
import { sendResponse } from '@core/common/functions/sendResponse';
import { handleControllerError } from '@core/common/functions/handleControllerError';
import { FastifyReply, FastifyRequest } from 'fastify';
import { container } from 'tsyringe';
import { ChatbotAiAgentsListerUseCase } from '@core/useCases/chatbot/ChatbotAiAgentsLister.useCase';

export const listAiAgents = async (
  request: FastifyRequest,
  reply: FastifyReply
) => {
  const chatbotAiAgentsListerUseCase = container.resolve(
    ChatbotAiAgentsListerUseCase
  );
  const { t, tokenJwtData } = request;

  try {
    const response = await chatbotAiAgentsListerUseCase.execute(
      tokenJwtData.account_id
    );

    return sendResponse(reply, {
      message: t('chatbot_ai_agents_listed_successfully'),
      httpStatusCode: EHTTPStatusCode.ok,
      data: response,
    });
  } catch (error) {
    handleControllerError(error, reply, t);
  }
};
