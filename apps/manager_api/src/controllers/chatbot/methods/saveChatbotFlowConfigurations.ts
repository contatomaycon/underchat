import { EHTTPStatusCode } from '@core/common/enums/EHTTPStatusCode';
import { sendResponse } from '@core/common/functions/sendResponse';
import { handleControllerError } from '@core/common/functions/handleControllerError';
import { FastifyReply, FastifyRequest } from 'fastify';
import { container } from 'tsyringe';
import { SaveChatbotFlowConfigurationsRequest } from '@core/schema/chatbot/saveChatbotFlowConfigurations/request.schema';
import { ChatbotFlowConfigurationsSaverUseCase } from '@core/useCases/chatbot/ChatbotFlowConfigurationsSaver.useCase';

export const saveChatbotFlowConfigurations = async (
  request: FastifyRequest<{
    Body: SaveChatbotFlowConfigurationsRequest;
  }>,
  reply: FastifyReply
) => {
  const chatbotFlowConfigurationsSaverUseCase = container.resolve(
    ChatbotFlowConfigurationsSaverUseCase
  );
  const { t, tokenJwtData } = request;

  try {
    const accountIdToUse = tokenJwtData.account_id;

    const chatbotConfigurationsId =
      await chatbotFlowConfigurationsSaverUseCase.execute(
        t,
        request.body,
        accountIdToUse,
        tokenJwtData.channels,
        tokenJwtData.actions
      );

    if (chatbotConfigurationsId) {
      return sendResponse(reply, {
        message: t('chatbot_flow_configurations_save_success'),
        httpStatusCode: EHTTPStatusCode.ok,
        data: {
          chatbot_configurations_id: chatbotConfigurationsId,
        },
      });
    }

    return sendResponse(reply, {
      message: t('chatbot_flow_configurations_save_error'),
      httpStatusCode: EHTTPStatusCode.bad_request,
    });
  } catch (error) {
    handleControllerError(error, reply, t);
  }
};
