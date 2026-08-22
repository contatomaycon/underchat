import { EHTTPStatusCode } from '@core/common/enums/EHTTPStatusCode';
import { sendResponse } from '@core/common/functions/sendResponse';
import { handleControllerError } from '@core/common/functions/handleControllerError';
import { FastifyReply, FastifyRequest } from 'fastify';
import { container } from 'tsyringe';
import { ListChannelChatbotsParams } from '@core/schema/chatbot/listChannelChatbots/request.schema';
import { ChatbotChannelChatbotsListerUseCase } from '@core/useCases/chatbot/ChatbotChannelChatbotsLister.useCase';

export const listChannelChatbots = async (
  request: FastifyRequest<{ Params: ListChannelChatbotsParams }>,
  reply: FastifyReply
) => {
  const useCase = container.resolve(ChatbotChannelChatbotsListerUseCase);
  const { t, tokenJwtData } = request;

  try {
    const response = await useCase.execute(
      t,
      tokenJwtData.account_id,
      request.params.worker_id,
      tokenJwtData.channels,
      tokenJwtData.actions
    );

    return sendResponse(reply, {
      message: t('chatbots_listed_successfully'),
      httpStatusCode: EHTTPStatusCode.ok,
      data: response,
    });
  } catch (error) {
    handleControllerError(error, reply, t);
  }
};
