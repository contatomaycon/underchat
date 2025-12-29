import { EHTTPStatusCode } from '@core/common/enums/EHTTPStatusCode';
import { sendResponse } from '@core/common/functions/sendResponse';
import { handleControllerError } from '@core/common/functions/handleControllerError';
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
    handleControllerError(error, reply, t);
  }
};
