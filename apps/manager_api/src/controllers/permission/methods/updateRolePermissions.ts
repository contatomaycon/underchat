import { EHTTPStatusCode } from '@core/common/enums/EHTTPStatusCode';
import { sendResponse } from '@core/common/functions/sendResponse';
import { handleControllerError } from '@core/common/functions/handleControllerError';
import { FastifyReply, FastifyRequest } from 'fastify';
import { container } from 'tsyringe';
import { RolePermissionsUpdaterUseCase } from '@core/useCases/permission/RolePermissionsUpdater.useCase';
import {
  UpdateRolePermissionsParams,
  UpdateRolePermissionsBody,
} from '@core/schema/permission/updateRolePermissions/request.schema';
import { UpdateRolePermissionsResponse } from '@core/schema/permission/updateRolePermissions/response.schema';

export const updateRolePermissions = async (
  request: FastifyRequest<{
    Params: UpdateRolePermissionsParams;
    Body: UpdateRolePermissionsBody;
  }>,
  reply: FastifyReply
) => {
  const rolePermissionsUpdaterUseCase = container.resolve(
    RolePermissionsUpdaterUseCase
  );
  const { t, tokenJwtData } = request;

  try {
    await rolePermissionsUpdaterUseCase.execute(
      t,
      request.params.permission_role_id,
      request.body.groups,
      tokenJwtData.account_id,
      tokenJwtData.permission_role_id
    );

    return sendResponse(reply, {
      message: t('role_permissions_updated_successfully'),
      httpStatusCode: EHTTPStatusCode.ok,
      data: { success: true } as UpdateRolePermissionsResponse,
    });
  } catch (error) {
    handleControllerError(error, reply, t);
  }
};
