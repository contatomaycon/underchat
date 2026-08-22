import { EHTTPStatusCode } from '@core/common/enums/EHTTPStatusCode';
import { sendResponse } from '@core/common/functions/sendResponse';
import { handleControllerError } from '@core/common/functions/handleControllerError';
import type { FastifyReply, FastifyRequest } from 'fastify';
import { container } from 'tsyringe';
import { BlockUserRequest } from '@core/schema/user/blockUser/request.schema';
import { PlanLimitEnforcementService } from '@core/services/planLimitEnforcement.service';
import { UserService } from '@core/services/user.service';
import { canOperateOnOtherAccounts } from '@core/common/functions/hasFullAccess';

export const blockUser = async (
  request: FastifyRequest<{
    Params: BlockUserRequest;
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
    if (request.params.user_id === tokenJwtData.user_id) {
      return sendResponse(reply, {
        message: t('cannot_block_current_user'),
        httpStatusCode: EHTTPStatusCode.bad_request,
      });
    }

    const targetAccountId = canOperateOnOthers
      ? await userService.getUserAccountId(request.params.user_id)
      : tokenJwtData.account_id;

    if (!targetAccountId) {
      return sendResponse(reply, {
        message: t('user_not_found'),
        httpStatusCode: EHTTPStatusCode.bad_request,
      });
    }

    const response = await planLimitEnforcementService.blockUser(
      t,
      targetAccountId,
      request.params.user_id
    );

    if (response) {
      return sendResponse(reply, {
        message: t('user_blocked_successfully'),
        httpStatusCode: EHTTPStatusCode.ok,
        data: response,
      });
    }

    return sendResponse(reply, {
      message: t('user_block_error'),
      httpStatusCode: EHTTPStatusCode.bad_request,
    });
  } catch (error) {
    handleControllerError(error, reply, t);
  }
};
