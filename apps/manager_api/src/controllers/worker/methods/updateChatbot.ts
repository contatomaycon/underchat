import { EHTTPStatusCode } from '@core/common/enums/EHTTPStatusCode';
import { sendResponse } from '@core/common/functions/sendResponse';
import { handleControllerError } from '@core/common/functions/handleControllerError';
import { FastifyReply, FastifyRequest } from 'fastify';
import { container } from 'tsyringe';
import { UpdateChatbotUseCase } from '@core/useCases/worker/UpdateChatbot.useCase';
import {
  UpdateChatbotRequest,
  UpdateChatbotParams,
} from '@core/schema/worker/updateChatbot/request.schema';

export const updateChatbot = async (
  request: FastifyRequest<{
    Params: UpdateChatbotParams;
    Body: UpdateChatbotRequest;
  }>,
  reply: FastifyReply
) => {
  const updateChatbotUseCase = container.resolve(UpdateChatbotUseCase);
  const { t, tokenJwtData } = request;

  try {
    const response = await updateChatbotUseCase.execute(
      t,
      tokenJwtData.account_id,
      request.params.worker_id,
      request.body
    );

    return sendResponse(reply, {
      message: t('chatbot_update_success'),
      httpStatusCode: EHTTPStatusCode.ok,
      data: response,
    });
  } catch (error) {
    handleControllerError(error, reply, t);
  }
};
