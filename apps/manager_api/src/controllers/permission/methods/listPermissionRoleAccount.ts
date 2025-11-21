import { EHTTPStatusCode } from '@core/common/enums/EHTTPStatusCode';
import { sendResponse } from '@core/common/functions/sendResponse';
import { FastifyReply, FastifyRequest } from 'fastify';
import { container } from 'tsyringe';
import { ListPermissionRoleAccountParamsRequest } from '@core/schema/permission/listPermissionRoleAccount/request.schema';
import { PermissionRoleAccountListerUseCase } from '@core/useCases/permission/PermissionRoleAccountLister.useCase';

export const listPermissionRoleAccount = async (
  request: FastifyRequest<{
    Params: ListPermissionRoleAccountParamsRequest;
  }>,
  reply: FastifyReply
) => {
  const permissionRoleAccountListerUseCase = container.resolve(
    PermissionRoleAccountListerUseCase
  );
  const { t, tokenJwtData } = request;

  try {
    const response = await permissionRoleAccountListerUseCase.execute(
      t,
      request.params.account_id,
      tokenJwtData.is_administrator
    );

    if (response) {
      return sendResponse(reply, {
        message: t('permission_role_account_list_successfully'),
        httpStatusCode: EHTTPStatusCode.ok,
        data: response,
      });
    }

    return sendResponse(reply, {
      message: t('permission_role_account_list_not_found'),
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
