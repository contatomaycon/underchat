import { EHTTPStatusCode } from '@core/common/enums/EHTTPStatusCode';
import { sendResponse } from '@core/common/functions/sendResponse';
import { FastifyReply, FastifyRequest } from 'fastify';
import { container } from 'tsyringe';
import { ViewRoleRequest } from '@core/schema/role/viewRole/request.schema';
import { RoleViewerUseCase } from '@core/useCases/role/RoleViewer.useCase';

export const viewRole = async (
  request: FastifyRequest<{
    Params: ViewRoleRequest;
  }>,
  reply: FastifyReply
) => {
  const roleViewerUseCase = container.resolve(RoleViewerUseCase);
  const { t, tokenJwtData } = request;

  try {
    const response = await roleViewerUseCase.execute(
      t,
      request.params.permission_role_id,
      tokenJwtData.account_id,
      tokenJwtData.is_administrator
    );

    if (response) {
      return sendResponse(reply, {
        message: t('role_view_successfully'),
        httpStatusCode: EHTTPStatusCode.ok,
        data: response,
      });
    }

    request.server.logger.info(response, request.id);

    return sendResponse(reply, {
      message: t('role_not_found'),
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
