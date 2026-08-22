import { EHTTPStatusCode } from '@core/common/enums/EHTTPStatusCode';
import { sendResponse } from '@core/common/functions/sendResponse';
import { handleChatbotFlowControllerError } from '@core/common/functions/handleChatbotFlowControllerError';
import { FastifyReply, FastifyRequest } from 'fastify';
import { container } from 'tsyringe';
import { SaveChatbotFlowRequest } from '@core/schema/chatbot/saveChatbotFlow/request.schema';
import { ChatbotFlowSaverUseCase } from '@core/useCases/chatbot/ChatbotFlowSaver.useCase';

export const saveChatbotFlow = async (
  request: FastifyRequest<{
    Body: SaveChatbotFlowRequest;
  }>,
  reply: FastifyReply
) => {
  const chatbotFlowSaverUseCase = container.resolve(ChatbotFlowSaverUseCase);
  const { t, tokenJwtData } = request;

  try {
    const accountIdToUse = tokenJwtData.account_id;

    const chatbotFlowId = await chatbotFlowSaverUseCase.execute(
      t,
      request.body as SaveChatbotFlowRequest & Record<string, unknown>,
      accountIdToUse,
      tokenJwtData.actions
    );

    if (chatbotFlowId) {
      return sendResponse(reply, {
        message: t('chatbot_flow_save_success'),
        httpStatusCode: EHTTPStatusCode.ok,
        data: {
          chatbot_flow_id: chatbotFlowId,
        },
      });
    }

    return sendResponse(reply, {
      message: t('chatbot_flow_save_error'),
      httpStatusCode: EHTTPStatusCode.bad_request,
    });
  } catch (error) {
    handleChatbotFlowControllerError(error, reply, t);
  }
};
