import { EHTTPStatusCode } from '@core/common/enums/EHTTPStatusCode';
import { sendResponse } from '@core/common/functions/sendResponse';
import { handleControllerError } from '@core/common/functions/handleControllerError';
import { FastifyReply, FastifyRequest } from 'fastify';
import { container } from 'tsyringe';
import { UserRolesListerUseCase } from '@core/useCases/user/UserRolesLister.useCase';

export const listUserRoles = async (
  request: FastifyRequest,
  reply: FastifyReply
) => {
  const userRolesListerUseCase = container.resolve(UserRolesListerUseCase);
  const { t, tokenJwtData } = request;

  try {
    const response = await userRolesListerUseCase.execute(
      tokenJwtData.account_id
    );

    return sendResponse(reply, {
      message: t('user_roles_list_successfully'),
      httpStatusCode: EHTTPStatusCode.ok,
      data: response,
    });
  } catch (error) {
    handleControllerError(error, reply, t);
  }
};
