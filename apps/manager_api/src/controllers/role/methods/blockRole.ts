import { EHTTPStatusCode } from '@core/common/enums/EHTTPStatusCode';
import { EPermissionRole } from '@core/common/enums/EPermissionRole';
import { sendResponse } from '@core/common/functions/sendResponse';
import { handleControllerError } from '@core/common/functions/handleControllerError';
import { FastifyReply, FastifyRequest } from 'fastify';
import { container } from 'tsyringe';
import { BlockRoleRequest } from '@core/schema/role/blockRole/request.schema';
import { PlanLimitEnforcementService } from '@core/services/planLimitEnforcement.service';

const systemRoleIds = [EPermissionRole.administrator, EPermissionRole.master];

export const blockRole = async (
  request: FastifyRequest<{
    Params: BlockRoleRequest;
  }>,
  reply: FastifyReply
) => {
  const planLimitEnforcementService = container.resolve(
    PlanLimitEnforcementService
  );
  const { t, tokenJwtData } = request;

  try {
    if (request.params.permission_role_id === tokenJwtData.permission_role_id) {
      return sendResponse(reply, {
        message: t('cannot_block_own_role'),
        httpStatusCode: EHTTPStatusCode.bad_request,
      });
    }

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

    const response = await planLimitEnforcementService.blockRole(
      tokenJwtData.account_id,
      request.params.permission_role_id
    );

    if (response) {
      return sendResponse(reply, {
        message: t('role_blocked_successfully'),
        httpStatusCode: EHTTPStatusCode.ok,
        data: response,
      });
    }

    return sendResponse(reply, {
      message: t('role_block_error'),
      httpStatusCode: EHTTPStatusCode.bad_request,
    });
  } catch (error) {
    handleControllerError(error, reply, t);
  }
};
