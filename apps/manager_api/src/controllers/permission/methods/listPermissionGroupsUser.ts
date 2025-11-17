import { EHTTPStatusCode } from '@core/common/enums/EHTTPStatusCode';
import { sendResponse } from '@core/common/functions/sendResponse';
import { FastifyReply, FastifyRequest } from 'fastify';
import { container } from 'tsyringe';
import { PermissionGroupsListerUserUseCase } from '@core/useCases/permission/PermissionGroupsListerUser.useCase';
import { ViewPermissionGroupsUserParams } from '@core/schema/permission/viewPermissionGroupsUser/request.schema';

export const listPermissionGroupsUser = async (
  request: FastifyRequest<{
    Params: ViewPermissionGroupsUserParams;
  }>,
  reply: FastifyReply
) => {
  const permissionGroupsListerUseCase = container.resolve(
    PermissionGroupsListerUserUseCase
  );
  const { t, tokenJwtData } = request;

  try {
    const response = await permissionGroupsListerUseCase.execute(
      t,
      tokenJwtData.account_id,
      request.params.permission_role_id,
      tokenJwtData.is_administrator
    );

    return sendResponse(reply, {
      message: t('permission_groups_list_successfully'),
      httpStatusCode: EHTTPStatusCode.ok,
      data: response,
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
