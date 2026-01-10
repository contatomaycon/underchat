import { EHTTPStatusCode } from '@core/common/enums/EHTTPStatusCode';
import { sendResponse } from '@core/common/functions/sendResponse';
import { handleControllerError } from '@core/common/functions/handleControllerError';
import { FastifyReply, FastifyRequest } from 'fastify';
import { container } from 'tsyringe';
import { ChatTransferUsersListerUseCase } from '@core/useCases/chat/ChatTransferUsersLister.useCase';

export const listTransferUsers = async (
  request: FastifyRequest,
  reply: FastifyReply
) => {
  const chatTransferUsersListerUseCase = container.resolve(
    ChatTransferUsersListerUseCase
  );
  const { t, tokenJwtData } = request;

  try {
    const response = await chatTransferUsersListerUseCase.execute(
      tokenJwtData.account_id
    );

    return sendResponse(reply, {
      message: t('transfer_users_listed_successfully'),
      httpStatusCode: EHTTPStatusCode.ok,
      data: response,
    });
  } catch (error) {
    handleControllerError(error, reply, t);
  }
};
