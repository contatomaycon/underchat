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

  const systemRoleIds = [
    '019a930d-c6f5-75af-82a5-899cb84b6089',
    '019a930d-c6f5-75af-82a5-8c20f9d0e6e2',
  ];

  if (request.params.permission_role_id === tokenJwtData.permission_role_id) {
    return sendResponse(reply, {
      message: t('cannot_delete_own_role'),
      httpStatusCode: EHTTPStatusCode.bad_request,
    });
  }

  if (systemRoleIds.includes(request.params.permission_role_id)) {
    return sendResponse(reply, {
      message: t('cannot_delete_system_role'),
      httpStatusCode: EHTTPStatusCode.bad_request,
    });
  }

  try {
    const response = await roleDeleterUseCase.execute(
      t,
      request.params.permission_role_id,
      tokenJwtData.account_id,
      tokenJwtData.is_administrator
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
