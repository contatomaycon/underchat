import { EHTTPStatusCode } from '@core/common/enums/EHTTPStatusCode';
import { sendResponse } from '@core/common/functions/sendResponse';
import { FastifyReply, FastifyRequest } from 'fastify';
import { container } from 'tsyringe';
import { ViewChatbotUseCase } from '@core/useCases/worker/ViewChatbot.useCase';
import { ViewChatbotParams } from '@core/schema/worker/viewChatbot/request.schema';

export const viewChatbot = async (
  request: FastifyRequest<{
    Params: ViewChatbotParams;
  }>,
  reply: FastifyReply
) => {
  const viewChatbotUseCase = container.resolve(ViewChatbotUseCase);
  const { t, tokenJwtData } = request;

  try {
    const response = await viewChatbotUseCase.execute(
      t,
      tokenJwtData.account_id,
      tokenJwtData.is_administrator,
      request.params.worker_id
    );

    return sendResponse(reply, {
      message: t('chatbot_view_success'),
      httpStatusCode: EHTTPStatusCode.ok,
      data: response,
    });
  } catch (error) {
    request.server.logger.error(error, request.id);

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
