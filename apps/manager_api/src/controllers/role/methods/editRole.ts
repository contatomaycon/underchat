import { EHTTPStatusCode } from '@core/common/enums/EHTTPStatusCode';
import { sendResponse } from '@core/common/functions/sendResponse';
import { FastifyReply, FastifyRequest } from 'fastify';
import { container } from 'tsyringe';
import { RoleUpdaterUseCase } from '@core/useCases/role/RoleUpdater.useCase';
import {
  EditRoleParamsRequest,
  EditRoleRequest,
} from '@core/schema/role/editRole/request.schema';

export const editRole = async (
  request: FastifyRequest<{
    Body: EditRoleRequest;
    Params: EditRoleParamsRequest;
  }>,
  reply: FastifyReply
) => {
  const roleUpdaterUseCase = container.resolve(RoleUpdaterUseCase);
  const { t, tokenJwtData } = request;

  try {
    const response = await roleUpdaterUseCase.execute(
      t,
      request.params.permission_role_id,
      request.body.name,
      tokenJwtData.account_id
    );

    if (response) {
      return sendResponse(reply, {
        message: t('role_update_successfully'),
        httpStatusCode: EHTTPStatusCode.ok,
      });
    }

    request.server.logger.info(response, request.id);

    return sendResponse(reply, {
      message: t('role_update_error'),
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
