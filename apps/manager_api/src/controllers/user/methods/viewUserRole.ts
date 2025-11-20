import { EHTTPStatusCode } from '@core/common/enums/EHTTPStatusCode';
import { sendResponse } from '@core/common/functions/sendResponse';
import { FastifyReply, FastifyRequest } from 'fastify';
import { container } from 'tsyringe';
import { ViewUserRoleParamsRequest } from '@core/schema/user/viewUserRole/request.schema';
import { UserService } from '@core/services/user.service';

export const viewUserRole = async (
  request: FastifyRequest<{
    Params: ViewUserRoleParamsRequest;
  }>,
  reply: FastifyReply
) => {
  const userService = container.resolve(UserService);
  const { t, tokenJwtData } = request;

  try {
    const existsUser = await userService.existsUserById(
      request.params.user_id,
      tokenJwtData.account_id,
      tokenJwtData.is_administrator
    );

    if (!existsUser) {
      return sendResponse(reply, {
        message: t('user_not_found'),
        httpStatusCode: EHTTPStatusCode.bad_request,
      });
    }

    const permissionRoleId = await userService.getUserRole(
      request.params.user_id
    );

    return sendResponse(reply, {
      message: t('user_role_viewed_successfully'),
      httpStatusCode: EHTTPStatusCode.ok,
      data: {
        permission_role_id: permissionRoleId,
      },
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

