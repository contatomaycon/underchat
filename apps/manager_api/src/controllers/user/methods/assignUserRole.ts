import { EHTTPStatusCode } from '@core/common/enums/EHTTPStatusCode';
import { sendResponse } from '@core/common/functions/sendResponse';
import { FastifyReply, FastifyRequest } from 'fastify';
import { container } from 'tsyringe';
import {
  AssignUserRoleRequest,
  AssignUserRoleParamsRequest,
} from '@core/schema/user/assignUserRole/request.schema';
import { UserRoleAssignerUseCase } from '@core/useCases/user/UserRoleAssigner.useCase';

export const assignUserRole = async (
  request: FastifyRequest<{
    Params: AssignUserRoleParamsRequest;
    Body: AssignUserRoleRequest;
  }>,
  reply: FastifyReply
) => {
  const userRoleAssignerUseCase = container.resolve(UserRoleAssignerUseCase);
  const { t, tokenJwtData } = request;

  try {
    const response = await userRoleAssignerUseCase.execute(
      t,
      request.params.user_id,
      tokenJwtData.account_id,
      tokenJwtData.is_administrator,
      request.body
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
