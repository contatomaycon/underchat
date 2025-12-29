import { EHTTPStatusCode } from '@core/common/enums/EHTTPStatusCode';
import { sendResponse } from '@core/common/functions/sendResponse';
import { handleControllerError } from '@core/common/functions/handleControllerError';
import { FastifyReply, FastifyRequest } from 'fastify';
import { container } from 'tsyringe';
import { UserUpdaterUseCase } from '@core/useCases/user/UserUpdater.useCase';
import {
  EditUserParamsRequest,
  UpdateUserRequest,
} from '@core/schema/user/editUser/request.schema';
import { canOperateOnOtherAccounts } from '@core/common/functions/hasFullAccess';

export const editUser = async (
  request: FastifyRequest<{
    Params: EditUserParamsRequest;
    Body: UpdateUserRequest;
  }>,
  reply: FastifyReply
) => {
  const userUpdaterUseCase = container.resolve(UserUpdaterUseCase);
  const { t, tokenJwtData } = request;

  const canOperateOnOthers = canOperateOnOtherAccounts(tokenJwtData.actions);

  try {
    if (request.body.account_id?.value && !canOperateOnOthers) {
      return sendResponse(reply, {
        message: t('permission_denied'),
        httpStatusCode: EHTTPStatusCode.forbidden,
      });
    }

    const accountIdToUse = request.body.account_id?.value
      ? request.body.account_id.value
      : tokenJwtData.account_id;

    const response = await userUpdaterUseCase.execute(
      t,
      request.params.user_id,
      request.body,
      accountIdToUse,
      canOperateOnOthers
    );

    if (response) {
      return sendResponse(reply, {
        message: t('user_update_successfully'),
        httpStatusCode: EHTTPStatusCode.ok,
      });
    }

    return sendResponse(reply, {
      message: t('user_update_error'),
      httpStatusCode: EHTTPStatusCode.bad_request,
    });
  } catch (error) {
    handleControllerError(error, reply, t);
  }
};
