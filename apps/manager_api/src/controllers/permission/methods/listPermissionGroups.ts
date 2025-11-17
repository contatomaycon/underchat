import { EHTTPStatusCode } from '@core/common/enums/EHTTPStatusCode';
import { sendResponse } from '@core/common/functions/sendResponse';
import { FastifyReply, FastifyRequest } from 'fastify';
import { container } from 'tsyringe';
import { PermissionGroupsListerUseCase } from '@core/useCases/permission/PermissionGroupsLister.useCase';

export const listPermissionGroups = async (
  request: FastifyRequest,
  reply: FastifyReply
) => {
  const permissionGroupsListerUseCase = container.resolve(
    PermissionGroupsListerUseCase
  );
  const { t, tokenJwtData } = request;

  try {
    const response = await permissionGroupsListerUseCase.execute(
      t,
      tokenJwtData.user_id
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
