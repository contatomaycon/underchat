import { EHTTPStatusCode } from '@core/common/enums/EHTTPStatusCode';
import { sendResponse } from '@core/common/functions/sendResponse';
import { handleControllerError } from '@core/common/functions/handleControllerError';
import type { FastifyReply, FastifyRequest } from 'fastify';
import { container } from 'tsyringe';
import { DeleteUserRequest } from '@core/schema/user/deleteUser/request.schema';
import { UserDeleterUseCase } from '@core/useCases/user/UserDeleter.useCase';
import { canOperateOnOtherAccounts } from '@core/common/functions/hasFullAccess';

export const deleteUser = async (
  request: FastifyRequest<{
    Params: DeleteUserRequest;
  }>,
  reply: FastifyReply
) => {
  const userDeleterUseCase = container.resolve(UserDeleterUseCase);
  const { t, tokenJwtData } = request;

  const canOperateOnOthers = canOperateOnOtherAccounts(tokenJwtData.actions);

  try {
    if (request.params.user_id === tokenJwtData.user_id) {
      return sendResponse(reply, {
        message: t('cannot_delete_own_user'),
        httpStatusCode: EHTTPStatusCode.forbidden,
      });
    }

    const response = await userDeleterUseCase.execute(
      t,
      request.params.user_id,
      tokenJwtData.account_id,
      canOperateOnOthers,
      tokenJwtData.user_id
    );

    if (response) {
      return sendResponse(reply, {
        message: t('user_deleted_successfully'),
        httpStatusCode: EHTTPStatusCode.ok,
      });
    }

    return sendResponse(reply, {
      message: t('user_deleter_error'),
      httpStatusCode: EHTTPStatusCode.bad_request,
    });
  } catch (error) {
    handleControllerError(error, reply, t);
  }
};
