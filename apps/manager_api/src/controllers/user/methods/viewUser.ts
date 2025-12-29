import { EHTTPStatusCode } from '@core/common/enums/EHTTPStatusCode';
import { sendResponse } from '@core/common/functions/sendResponse';
import { handleControllerError } from '@core/common/functions/handleControllerError';
import { canOperateOnOtherAccounts } from '@core/common/functions/hasFullAccess';
import { FastifyReply, FastifyRequest } from 'fastify';
import { container } from 'tsyringe';
import { ViewUserRequest } from '@core/schema/user/viewUser/request.schema';
import { UserViewerUseCase } from '@core/useCases/user/UserViewer.useCase';

export const viewUser = async (
  request: FastifyRequest<{
    Params: ViewUserRequest;
  }>,
  reply: FastifyReply
) => {
  const userViewerUseCase = container.resolve(UserViewerUseCase);
  const { t, tokenJwtData } = request;
  const canOperateOnOthers = canOperateOnOtherAccounts(tokenJwtData.actions);

  try {
    const response = await userViewerUseCase.execute(
      t,
      request.params.user_id,
      tokenJwtData.account_id,
      canOperateOnOthers
    );

    if (response) {
      return sendResponse(reply, {
        message: t('user_view_successfully'),
        httpStatusCode: EHTTPStatusCode.ok,
        data: response,
      });
    }

    return sendResponse(reply, {
      message: t('user_not_found'),
      httpStatusCode: EHTTPStatusCode.bad_request,
    });
  } catch (error) {
    handleControllerError(error, reply, t);
  }
};
