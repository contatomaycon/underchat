import { EHTTPStatusCode } from '@core/common/enums/EHTTPStatusCode';
import { sendResponse } from '@core/common/functions/sendResponse';
import { handleChatbotFlowControllerError } from '@core/common/functions/handleChatbotFlowControllerError';
import { FastifyReply, FastifyRequest } from 'fastify';
import { container } from 'tsyringe';
import { CloneChatbotRequest } from '@core/schema/chatbot/cloneChatbot/request.schema';
import { ChatbotClonerUseCase } from '@core/useCases/chatbot/ChatbotCloner.useCase';

export const cloneChatbot = async (
  request: FastifyRequest<{
    Body: CloneChatbotRequest;
  }>,
  reply: FastifyReply
) => {
  const chatbotClonerUseCase = container.resolve(ChatbotClonerUseCase);
  const { t, tokenJwtData } = request;

  try {
    const accountIdToUse = tokenJwtData.account_id;

    const response = await chatbotClonerUseCase.execute(
      t,
      request.body,
      accountIdToUse,
      tokenJwtData.actions
    );

    if (response) {
      return sendResponse(reply, {
        message: t('chatbot_cloner_success'),
        httpStatusCode: EHTTPStatusCode.ok,
        data: response,
      });
    }

    return sendResponse(reply, {
      message: t('chatbot_cloner_error'),
      httpStatusCode: EHTTPStatusCode.bad_request,
    });
  } catch (error) {
    handleChatbotFlowControllerError(error, reply, t);
  }
};
