import { EHTTPStatusCode } from '@core/common/enums/EHTTPStatusCode';
import { sendResponse } from '@core/common/functions/sendResponse';
import { handleControllerError } from '@core/common/functions/handleControllerError';
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
      request.params.permission_role_id
    );

    return sendResponse(reply, {
      message: t('permission_groups_list_successfully'),
      httpStatusCode: EHTTPStatusCode.ok,
      data: response,
    });
  } catch (error) {
    handleControllerError(error, reply, t);
  }
};
