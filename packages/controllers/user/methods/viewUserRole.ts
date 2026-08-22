import { EHTTPStatusCode } from '@core/common/enums/EHTTPStatusCode';
import { sendResponse } from '@core/common/functions/sendResponse';
import { handleControllerError } from '@core/common/functions/handleControllerError';
import { canOperateOnOtherAccounts } from '@core/common/functions/hasFullAccess';
import type { FastifyReply, FastifyRequest } from 'fastify';
import { container } from 'tsyringe';
import { ViewUserRoleParamsRequest } from '@core/schema/user/viewUserRole/request.schema';
import { UserRoleViewerUseCase } from '@core/useCases/user/UserRoleViewer.useCase';

export const viewUserRole = async (
  request: FastifyRequest<{
    Params: ViewUserRoleParamsRequest;
  }>,
  reply: FastifyReply
) => {
  const userRoleViewerUseCase = container.resolve(UserRoleViewerUseCase);
  const { t, tokenJwtData } = request;
  const canOperateOnOthers = canOperateOnOtherAccounts(tokenJwtData.actions);

  try {
    const permissionRoleId = await userRoleViewerUseCase.execute(
      t,
      request.params.user_id,
      tokenJwtData.account_id,
      canOperateOnOthers
    );

    return sendResponse(reply, {
      message: t('user_role_viewed_successfully'),
      httpStatusCode: EHTTPStatusCode.ok,
      data: {
        permission_role_id: permissionRoleId,
      },
    });
  } catch (error) {
    handleControllerError(error, reply, t);
  }
};
