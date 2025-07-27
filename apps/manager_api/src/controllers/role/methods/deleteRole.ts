import { EHTTPStatusCode } from '@core/common/enums/EHTTPStatusCode';
import { sendResponse } from '@core/common/functions/sendResponse';
import { FastifyReply, FastifyRequest } from 'fastify';
import { container } from 'tsyringe';
import { DeleteRoleRequest } from '@core/schema/role/deleteRole/request.schema';
import { RoleDeleterUseCase } from '@core/useCases/role/RoleDeleter.useCase';

export const deleteRole = async (
  request: FastifyRequest<{
    Params: DeleteRoleRequest;
  }>,
  reply: FastifyReply
) => {
  const roleDeleterUseCase = container.resolve(RoleDeleterUseCase);
  const { t, tokenJwtData } = request;

  try {
    const response = await roleDeleterUseCase.execute(
      t,
      request.params.permission_role_id,
      tokenJwtData.account_id
    );

    if (response) {
      return sendResponse(reply, {
        message: t('role_deleted_successfully'),
        httpStatusCode: EHTTPStatusCode.ok,
      });
    }

    request.server.logger.info(response, request.id);

    return sendResponse(reply, {
      message: t('role_deleter_error'),
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
