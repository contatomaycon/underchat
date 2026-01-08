import { EHTTPStatusCode } from '@core/common/enums/EHTTPStatusCode';
import { sendResponse } from '@core/common/functions/sendResponse';
import { handleControllerError } from '@core/common/functions/handleControllerError';
import { FastifyReply, FastifyRequest } from 'fastify';
import { container } from 'tsyringe';
import { ViewChatbotConfigUseCase } from '@core/useCases/chatbot/ViewChatbotConfig.useCase';

export const viewChatbotConfig = async (
  request: FastifyRequest,
  reply: FastifyReply
) => {
  const viewChatbotConfigUseCase = container.resolve(ViewChatbotConfigUseCase);
  const { t, tokenJwtData } = request;

  try {
    const response = await viewChatbotConfigUseCase.execute(
      tokenJwtData.account_id
    );

    return sendResponse(reply, {
      message: t('chatbot_config_view_success'),
      httpStatusCode: EHTTPStatusCode.ok,
      data: response,
    });
  } catch (error) {
    handleControllerError(error, reply, t);
  }
};
