import { EHTTPStatusCode } from '@core/common/enums/EHTTPStatusCode';
import { sendResponse } from '@core/common/functions/sendResponse';
import { FastifyReply, FastifyRequest } from 'fastify';
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
    const response = await userDeleterUseCase.execute(
      t,
      request.params.user_id,
      tokenJwtData.account_id,
      canOperateOnOthers
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
