import { EHTTPStatusCode } from '@core/common/enums/EHTTPStatusCode';
import { sendResponse } from '@core/common/functions/sendResponse';
import { handleControllerError } from '@core/common/functions/handleControllerError';
import type { FastifyReply, FastifyRequest } from 'fastify';
import { container } from 'tsyringe';
import { UserRolesListerUseCase } from '@core/useCases/user/UserRolesLister.useCase';
import { canOperateOnOtherAccounts } from '@core/common/functions/hasFullAccess';
import { ListUserRolesRequest } from '@core/schema/user/listUserRoles/request.schema';

export const listUserRoles = async (
  request: FastifyRequest<{
    Querystring: ListUserRolesRequest;
  }>,
  reply: FastifyReply
) => {
  const userRolesListerUseCase = container.resolve(UserRolesListerUseCase);
  const { t, tokenJwtData } = request;
  const canOperateOnOthers = canOperateOnOtherAccounts(tokenJwtData.actions);

  try {
    const accountIdToUse =
      canOperateOnOthers && request.query.account_id
        ? request.query.account_id
        : tokenJwtData.account_id;

    const response = await userRolesListerUseCase.execute(accountIdToUse);

    return sendResponse(reply, {
      message: t('user_roles_list_successfully'),
      httpStatusCode: EHTTPStatusCode.ok,
      data: response,
    });
  } catch (error) {
    handleControllerError(error, reply, t);
  }
};
