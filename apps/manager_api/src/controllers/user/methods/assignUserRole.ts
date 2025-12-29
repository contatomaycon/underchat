import { EHTTPStatusCode } from '@core/common/enums/EHTTPStatusCode';
import { sendResponse } from '@core/common/functions/sendResponse';
import { handleControllerError } from '@core/common/functions/handleControllerError';
import { FastifyReply, FastifyRequest } from 'fastify';
import { container } from 'tsyringe';
import {
  AssignUserRoleRequest,
  AssignUserRoleParamsRequest,
} from '@core/schema/user/assignUserRole/request.schema';
import { UserRoleAssignerUseCase } from '@core/useCases/user/UserRoleAssigner.useCase';
import { canOperateOnOtherAccounts } from '@core/common/functions/hasFullAccess';

export const assignUserRole = async (
  request: FastifyRequest<{
    Params: AssignUserRoleParamsRequest;
    Body: AssignUserRoleRequest;
  }>,
  reply: FastifyReply
) => {
  const userRoleAssignerUseCase = container.resolve(UserRoleAssignerUseCase);
  const { t, tokenJwtData } = request;

  const canOperateOnOthers = canOperateOnOtherAccounts(tokenJwtData.actions);

  try {
    const response = await userRoleAssignerUseCase.execute(
      t,
      request.params.user_id,
      tokenJwtData.account_id,
      request.body,
      canOperateOnOthers
    );

    if (response) {
      return sendResponse(reply, {
        message: t('user_role_assigned_successfully'),
        httpStatusCode: EHTTPStatusCode.ok,
        data: null,
      });
    }

    return sendResponse(reply, {
      message: t('user_role_assignment_failed'),
      httpStatusCode: EHTTPStatusCode.bad_request,
    });
  } catch (error) {
    handleControllerError(error, reply, t);
  }
};
