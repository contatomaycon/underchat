import { EHTTPStatusCode } from '@core/common/enums/EHTTPStatusCode';
import { sendResponse } from '@core/common/functions/sendResponse';
import { FastifyReply, FastifyRequest } from 'fastify';
import { container } from 'tsyringe';
import { UserCardDeleterUseCase } from '@core/useCases/accountSettings/UserCardDeleter.useCase';
import { DeleteUserCardRequest } from '@core/schema/accountSettings/deleteUserCard/request.schema';

export const deleteUserCard = async (
  request: FastifyRequest<{ Params: DeleteUserCardRequest }>,
  reply: FastifyReply
) => {
  const userCardDeleterUseCase = container.resolve(UserCardDeleterUseCase);
  const { t, tokenJwtData } = request;

  try {
    await userCardDeleterUseCase.execute(
      t,
      request.params.user_card_id,
      tokenJwtData.user_id,
      tokenJwtData.account_id
    );

    return sendResponse(reply, {
      message: t('card_deleted_successfully'),
      httpStatusCode: EHTTPStatusCode.ok,
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
