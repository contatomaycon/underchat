import { EHTTPStatusCode } from '@core/common/enums/EHTTPStatusCode';
import { sendResponse } from '@core/common/functions/sendResponse';
import { FastifyReply, FastifyRequest } from 'fastify';
import { container } from 'tsyringe';
import { ViewUserAddress2Request } from '@core/schema/user/viewUserAddress2/request.schema';
import { UserAddress2ViewerUseCase } from '@core/useCases/user/UserAddress2Viewer.useCase';

export const viewUserAddress2 = async (
  request: FastifyRequest<{
    Params: ViewUserAddress2Request;
  }>,
  reply: FastifyReply
) => {
  const userAddress2ViewerUseCase = container.resolve(
    UserAddress2ViewerUseCase
  );
  const { t } = request;

  try {
    const response = await userAddress2ViewerUseCase.execute(
      t,
      request.params.user_id
    );

    if (response) {
      return sendResponse(reply, {
        message: t('user_address2_view_successfully'),
        httpStatusCode: EHTTPStatusCode.ok,
        data: response,
      });
    }


    return sendResponse(reply, {
      message: t('user_not_found'),
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
