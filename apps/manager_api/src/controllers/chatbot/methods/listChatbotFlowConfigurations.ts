import { EHTTPStatusCode } from '@core/common/enums/EHTTPStatusCode';
import { sendResponse } from '@core/common/functions/sendResponse';
import { FastifyReply, FastifyRequest } from 'fastify';
import { container } from 'tsyringe';
import { ListChatbotFlowConfigurationsRequest } from '@core/schema/chatbot/listChatbotFlowConfigurations/request.schema';
import { ChatbotFlowConfigurationsListerUseCase } from '@core/useCases/chatbot/ChatbotFlowConfigurationsLister.useCase';

export const listChatbotFlowConfigurations = async (
  request: FastifyRequest<{
    Querystring: ListChatbotFlowConfigurationsRequest;
  }>,
  reply: FastifyReply
) => {
  const chatbotFlowConfigurationsListerUseCase = container.resolve(
    ChatbotFlowConfigurationsListerUseCase
  );
  const { t, tokenJwtData } = request;

  try {
    const response = await chatbotFlowConfigurationsListerUseCase.execute(
      tokenJwtData.account_id,
      request.query.chatbot_id
    );

    return sendResponse(reply, {
      message: t('chatbot_flow_configurations_list_successfully'),
      httpStatusCode: EHTTPStatusCode.ok,
      data: response,
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
