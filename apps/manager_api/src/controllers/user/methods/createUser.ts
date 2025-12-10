import { EHTTPStatusCode } from '@core/common/enums/EHTTPStatusCode';
import { sendResponse } from '@core/common/functions/sendResponse';
import { canOperateOnOtherAccounts } from '@core/common/functions/hasFullAccess';
import { FastifyReply, FastifyRequest } from 'fastify';
import { container } from 'tsyringe';
import { CreateUserRequest } from '@core/schema/user/createUser/request.schema';
import { UserCreatorUseCase } from '@core/useCases/user/UserCreator.useCase';

export const createUser = async (
  request: FastifyRequest<{
    Body: CreateUserRequest;
  }>,
  reply: FastifyReply
) => {
  const userCreatorUseCase = container.resolve(UserCreatorUseCase);
  const { t, tokenJwtData } = request;
  const canOperateOnOthers = canOperateOnOtherAccounts(tokenJwtData.actions);

  try {
    let accountIdToUse = tokenJwtData.account_id;

    if (request.body.account_id?.value) {
      if (!canOperateOnOthers) {
        return sendResponse(reply, {
          message: t('permission_denied'),
          httpStatusCode: EHTTPStatusCode.forbidden,
        });
      }

      accountIdToUse = request.body.account_id.value;
    }

    const response = await userCreatorUseCase.execute(
      t,
      request.body,
      accountIdToUse
    );

    if (response) {
      return sendResponse(reply, {
        message: t('user_creator_success'),
        httpStatusCode: EHTTPStatusCode.ok,
        data: response,
      });
    }

    return sendResponse(reply, {
      message: t('user_creator_error'),
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
