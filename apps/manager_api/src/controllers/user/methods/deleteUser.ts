import { EHTTPStatusCode } from '@core/common/enums/EHTTPStatusCode';
import { sendResponse } from '@core/common/functions/sendResponse';
import { FastifyReply, FastifyRequest } from 'fastify';
import { container } from 'tsyringe';
import { DeleteUserRequest } from '@core/schema/user/deleteUser/request.schema';
import { UserDeleterUseCase } from '@core/useCases/user/UserDeleter.useCase';

export const deleteUser = async (
  request: FastifyRequest<{
    Params: DeleteUserRequest;
  }>,
  reply: FastifyReply
) => {
  const userDeleterUseCase = container.resolve(UserDeleterUseCase);
  const { t, tokenJwtData } = request;

  try {
    const response = await userDeleterUseCase.execute(
      t,
      request.params.user_id,
      tokenJwtData.account_id,
      tokenJwtData.is_administrator
    );

    if (response) {
      return sendResponse(reply, {
        message: t('user_deleted_successfully'),
        httpStatusCode: EHTTPStatusCode.ok,
      });
    }

    request.server.logger.info(response, request.id);

    return sendResponse(reply, {
      message: t('user_deleter_error'),
      httpStatusCode: EHTTPStatusCode.bad_request,
    });
  } catch (error) {
    request.server.logger.error(error, request.id);

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
