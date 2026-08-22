import { EHTTPStatusCode } from '@core/common/enums/EHTTPStatusCode';
import { sendResponse } from '@core/common/functions/sendResponse';
import { handleControllerError } from '@core/common/functions/handleControllerError';
import type { FastifyReply, FastifyRequest } from 'fastify';
import { container } from 'tsyringe';
import { ViewUserAddress1Request } from '@core/schema/user/viewUserAddress1/request.schema';
import { UserAddress1ViewerUseCase } from '@core/useCases/user/UserAddress1Viewer.useCase';

export const viewUserAddress1 = async (
  request: FastifyRequest<{
    Params: ViewUserAddress1Request;
  }>,
  reply: FastifyReply
) => {
  const userAddress1ViewerUseCase = container.resolve(
    UserAddress1ViewerUseCase
  );
  const { t } = request;

  try {
    const response = await userAddress1ViewerUseCase.execute(
      t,
      request.params.user_id
    );

    if (response) {
      return sendResponse(reply, {
        message: t('user_address1_view_successfully'),
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
