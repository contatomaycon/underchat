import { EHTTPStatusCode } from '@core/common/enums/EHTTPStatusCode';
import { sendResponse } from '@core/common/functions/sendResponse';
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
      tokenJwtData.account_id,
      tokenJwtData.user_id
    );

    return sendResponse(reply, {
      message: t('transfer_users_listed_successfully'),
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
