import { EHTTPStatusCode } from '@core/common/enums/EHTTPStatusCode';
import { sendResponse } from '@core/common/functions/sendResponse';
import { FastifyReply, FastifyRequest } from 'fastify';
import { container } from 'tsyringe';
import { ListChatbotFlowRequest } from '@core/schema/chatbot/listChatbotFlow/request.schema';
import { ChatbotFlowListerUseCase } from '@core/useCases/chatbot/ChatbotFlowLister.useCase';

export const listChatbotFlow = async (
  request: FastifyRequest<{
    Querystring: ListChatbotFlowRequest;
  }>,
  reply: FastifyReply
) => {
  const chatbotFlowListerUseCase = container.resolve(ChatbotFlowListerUseCase);
  const { t, tokenJwtData } = request;

  try {
    const response = await chatbotFlowListerUseCase.execute(
      tokenJwtData.account_id,
      request.query.chatbot_id
    );

    return sendResponse(reply, {
      message: t('chatbot_flow_list_successfully'),
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
