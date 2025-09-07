import { EHTTPStatusCode } from '@core/common/enums/EHTTPStatusCode';
import { sendResponse } from '@core/common/functions/sendResponse';
import { FastifyReply, FastifyRequest } from 'fastify';
import { container } from 'tsyringe';
import { ViewAccountRequest } from '@core/schema/account/viewAccount/request.schema';
import { AccountViewerUseCase } from '@core/useCases/account/AccountViewer.useCase';

export const viewAccount = async (
  request: FastifyRequest<{
    Params: ViewAccountRequest;
  }>,
  reply: FastifyReply
) => {
  const accountViewerUseCase = container.resolve(AccountViewerUseCase);
  const { t, tokenJwtData } = request;

  try {
    const response = await accountViewerUseCase.execute(
      t,
      request.params.account_id,
      tokenJwtData.is_administrator
    );

    if (response) {
      return sendResponse(reply, {
        message: t('account_view_successfully'),
        httpStatusCode: EHTTPStatusCode.ok,
        data: response,
      });
    }

    request.server.logger.info(response, request.id);

    return sendResponse(reply, {
      message: t('account_not_found'),
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
