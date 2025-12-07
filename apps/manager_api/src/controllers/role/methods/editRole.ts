import { EHTTPStatusCode } from '@core/common/enums/EHTTPStatusCode';
import { sendResponse } from '@core/common/functions/sendResponse';
import { FastifyReply, FastifyRequest } from 'fastify';
import { container } from 'tsyringe';
import { RoleUpdaterUseCase } from '@core/useCases/role/RoleUpdater.useCase';
import {
  EditRoleParamsRequest,
  UpdateRoleRequest,
} from '@core/schema/role/editRole/request.schema';
import { EPermissionRole } from '@core/common/enums/EPermissionRole';

export const editRole = async (
  request: FastifyRequest<{
    Params: EditRoleParamsRequest;
    Body: UpdateRoleRequest;
  }>,
  reply: FastifyReply
) => {
  const roleUpdaterUseCase = container.resolve(RoleUpdaterUseCase);
  const { t, tokenJwtData } = request;

  const systemRoleIds = [EPermissionRole.administrator, EPermissionRole.master];

  if (request.params.permission_role_id === tokenJwtData.permission_role_id) {
    return sendResponse(reply, {
      message: t('cannot_edit_own_role'),
      httpStatusCode: EHTTPStatusCode.bad_request,
    });
  }

  if (
    systemRoleIds.includes(request.params.permission_role_id as EPermissionRole)
  ) {
    return sendResponse(reply, {
      message: t('cannot_edit_system_role'),
      httpStatusCode: EHTTPStatusCode.bad_request,
    });
  }

  try {
    const response = await roleUpdaterUseCase.execute(
      t,
      request.params.permission_role_id,
      request.body.name,
      tokenJwtData.account_id,
      tokenJwtData.is_administrator,
      request.body.description
    );

    if (response) {
      return sendResponse(reply, {
        message: t('role_update_successfully'),
        httpStatusCode: EHTTPStatusCode.ok,
      });
    }


    return sendResponse(reply, {
      message: t('role_update_error'),
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
