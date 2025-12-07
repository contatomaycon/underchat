import { EHTTPStatusCode } from '@core/common/enums/EHTTPStatusCode';
import { sendResponse } from '@core/common/functions/sendResponse';
import { FastifyReply, FastifyRequest } from 'fastify';
import { container } from 'tsyringe';
import { UserUpdaterUseCase } from '@core/useCases/user/UserUpdater.useCase';
import {
  EditUserParamsRequest,
  UpdateUserRequest,
} from '@core/schema/user/editUser/request.schema';

export const editUser = async (
  request: FastifyRequest<{
    Params: EditUserParamsRequest;
    Body: UpdateUserRequest;
  }>,
  reply: FastifyReply
) => {
  const userUpdaterUseCase = container.resolve(UserUpdaterUseCase);
  const { t, tokenJwtData } = request;

  try {
    const accountIdToUse =
      tokenJwtData.is_administrator && request.body.account_id?.value
        ? request.body.account_id.value
        : tokenJwtData.account_id;

    const response = await userUpdaterUseCase.execute(
      t,
      request.params.user_id,
      request.body,
      accountIdToUse,
      tokenJwtData.is_administrator
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
