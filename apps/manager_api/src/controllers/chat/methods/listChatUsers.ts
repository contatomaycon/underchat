import { EHTTPStatusCode } from '@core/common/enums/EHTTPStatusCode';
import { sendResponse } from '@core/common/functions/sendResponse';
import { handleControllerError } from '@core/common/functions/handleControllerError';
import { FastifyReply, FastifyRequest } from 'fastify';
import { container } from 'tsyringe';
import { ChatUsersListerUseCase } from '@core/useCases/chat/ChatUsersLister.useCase';

export const listChatUsers = async (
  request: FastifyRequest,
  reply: FastifyReply
) => {
  const chatUsersListerUseCase = container.resolve(ChatUsersListerUseCase);
  const { t, tokenJwtData } = request;

  try {
    const response = await chatUsersListerUseCase.execute(
      tokenJwtData.account_id
    );

    return sendResponse(reply, {
      message: t('users_listed_successfully'),
      httpStatusCode: EHTTPStatusCode.ok,
      data: response,
    });
  } catch (error) {
    handleControllerError(error, reply, t);
  }
};
