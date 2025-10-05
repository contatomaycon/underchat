import { EHTTPStatusCode } from '@core/common/enums/EHTTPStatusCode';
import { sendResponse } from '@core/common/functions/sendResponse';
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

  try {
    const response = await userViewerUseCase.execute(
      t,
      request.params.user_id,
      tokenJwtData.account_id,
      tokenJwtData.is_administrator
    );

    if (response) {
      return sendResponse(reply, {
        message: t('user_view_successfully'),
        httpStatusCode: EHTTPStatusCode.ok,
        data: response,
      });
    }

    request.server.logger.info(response, request.id);

    return sendResponse(reply, {
      message: t('user_not_found'),
      httpStatusCode: EHTTPStatusCode.bad_request,
    });
  } catch (error) {
    request.server.logger.error(error, request.id);

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
