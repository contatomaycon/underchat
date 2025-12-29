import { EHTTPStatusCode } from '@core/common/enums/EHTTPStatusCode';
import { sendResponse } from '@core/common/functions/sendResponse';
import { handleControllerError } from '@core/common/functions/handleControllerError';
import { FastifyReply, FastifyRequest } from 'fastify';
import { container } from 'tsyringe';
import { ChatbotUsersListerUseCase } from '@core/useCases/chatbot/ChatbotUsersLister.useCase';

export const listUsers = async (
  request: FastifyRequest,
  reply: FastifyReply
) => {
  const chatbotUsersListerUseCase = container.resolve(
    ChatbotUsersListerUseCase
  );
  const { t, tokenJwtData } = request;

  try {
    const response = await chatbotUsersListerUseCase.execute(
      tokenJwtData.account_id,
      tokenJwtData.user_id
    );

    return sendResponse(reply, {
      message: t('chatbot_users_listed_successfully'),
      httpStatusCode: EHTTPStatusCode.ok,
      data: response,
    });
  } catch (error) {
    handleControllerError(error, reply, t);
  }
};
