import { EHTTPStatusCode } from '@core/common/enums/EHTTPStatusCode';
import { EPermissionRole } from '@core/common/enums/EPermissionRole';
import { sendResponse } from '@core/common/functions/sendResponse';
import { handleControllerError } from '@core/common/functions/handleControllerError';
import { FastifyReply, FastifyRequest } from 'fastify';
import { container } from 'tsyringe';
import { UnblockRoleRequest } from '@core/schema/role/unblockRole/request.schema';
import { PlanLimitEnforcementService } from '@core/services/planLimitEnforcement.service';

const systemRoleIds = [EPermissionRole.administrator, EPermissionRole.master];

export const unblockRole = async (
  request: FastifyRequest<{
    Params: UnblockRoleRequest;
  }>,
  reply: FastifyReply
) => {
  const planLimitEnforcementService = container.resolve(
    PlanLimitEnforcementService
  );
  const { t, tokenJwtData } = request;

  try {
    if (
      systemRoleIds.includes(
        request.params.permission_role_id as EPermissionRole
      )
    ) {
      return sendResponse(reply, {
        message: t('cannot_block_system_role'),
        httpStatusCode: EHTTPStatusCode.bad_request,
      });
    }

    const response = await planLimitEnforcementService.unblockRole(
      t,
      tokenJwtData.account_id,
      request.params.permission_role_id
    );

    if (response) {
      return sendResponse(reply, {
        message: t('role_unblocked_successfully'),
        httpStatusCode: EHTTPStatusCode.ok,
        data: response,
      });
    }

    return sendResponse(reply, {
      message: t('role_unblock_error'),
      httpStatusCode: EHTTPStatusCode.bad_request,
    });
  } catch (error) {
    handleControllerError(error, reply, t);
  }
};
