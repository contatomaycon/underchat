import { EHTTPStatusCode } from '@core/common/enums/EHTTPStatusCode';
import { sendResponse } from '@core/common/functions/sendResponse';
import { handleControllerError } from '@core/common/functions/handleControllerError';
import type { FastifyReply, FastifyRequest } from 'fastify';
import { container } from 'tsyringe';
import { UnblockUserRequest } from '@core/schema/user/unblockUser/request.schema';
import { PlanLimitEnforcementService } from '@core/services/planLimitEnforcement.service';
import { UserService } from '@core/services/user.service';
import { canOperateOnOtherAccounts } from '@core/common/functions/hasFullAccess';

export const unblockUser = async (
  request: FastifyRequest<{
    Params: UnblockUserRequest;
  }>,
  reply: FastifyReply
) => {
  const planLimitEnforcementService = container.resolve(
    PlanLimitEnforcementService
  );
  const userService = container.resolve(UserService);
  const { t, tokenJwtData } = request;
  const canOperateOnOthers = canOperateOnOtherAccounts(tokenJwtData.actions);

  try {
    const targetAccountId = canOperateOnOthers
      ? await userService.getUserAccountId(request.params.user_id)
      : tokenJwtData.account_id;

    if (!targetAccountId) {
      return sendResponse(reply, {
        message: t('user_not_found'),
        httpStatusCode: EHTTPStatusCode.bad_request,
      });
    }

    const response = await planLimitEnforcementService.unblockUser(
      t,
      targetAccountId,
      request.params.user_id
    );

    if (response) {
      return sendResponse(reply, {
        message: t('user_unblocked_successfully'),
        httpStatusCode: EHTTPStatusCode.ok,
        data: response,
      });
    }

    return sendResponse(reply, {
      message: t('user_unblock_error'),
      httpStatusCode: EHTTPStatusCode.bad_request,
    });
  } catch (error) {
    handleControllerError(error, reply, t);
  }
};
