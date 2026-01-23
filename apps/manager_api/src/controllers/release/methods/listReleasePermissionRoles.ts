import { EHTTPStatusCode } from '@core/common/enums/EHTTPStatusCode';
import { sendResponse } from '@core/common/functions/sendResponse';
import { handleControllerError } from '@core/common/functions/handleControllerError';
import { FastifyReply, FastifyRequest } from 'fastify';
import { container } from 'tsyringe';
import { ReleasePermissionRolesListerUseCase } from '@core/useCases/release/ReleasePermissionRolesLister.useCase';

export const listReleasePermissionRoles = async (
  request: FastifyRequest,
  reply: FastifyReply
) => {
  const releasePermissionRolesListerUseCase = container.resolve(
    ReleasePermissionRolesListerUseCase
  );
  const { t, tokenJwtData } = request;

  try {
    const response = await releasePermissionRolesListerUseCase.execute(
      tokenJwtData.account_id
    );

    return sendResponse(reply, {
      message: t('release_permission_roles_list_success'),
      httpStatusCode: EHTTPStatusCode.ok,
      data: response,
    });
  } catch (error) {
    handleControllerError(error, reply, t);
  }
};
