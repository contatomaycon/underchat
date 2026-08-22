import { EHTTPStatusCode } from '@core/common/enums/EHTTPStatusCode';
import { sendResponse } from '@core/common/functions/sendResponse';
import { handleControllerError } from '@core/common/functions/handleControllerError';
import { FastifyReply, FastifyRequest } from 'fastify';
import { container } from 'tsyringe';
import { ChatbotChannelsListerUseCase } from '@core/useCases/chatbot/ChatbotChannelsLister.useCase';

export const listChannels = async (
  request: FastifyRequest,
  reply: FastifyReply
) => {
  const chatbotChannelsListerUseCase = container.resolve(
    ChatbotChannelsListerUseCase
  );
  const { t, tokenJwtData } = request;

  try {
    const response = await chatbotChannelsListerUseCase.execute(
      tokenJwtData.account_id,
      tokenJwtData.channels,
      tokenJwtData.actions
    );

    return sendResponse(reply, {
      message: t('transfer_options_listed_successfully'),
      httpStatusCode: EHTTPStatusCode.ok,
      data: response,
    });
  } catch (error) {
    handleControllerError(error, reply, t);
  }
};
