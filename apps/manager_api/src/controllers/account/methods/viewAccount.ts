import { EHTTPStatusCode } from '@core/common/enums/EHTTPStatusCode';
import { sendResponse } from '@core/common/functions/sendResponse';
import { handleControllerError } from '@core/common/functions/handleControllerError';
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
  const { t } = request;

  try {
    const response = await accountViewerUseCase.execute(
      t,
      request.params.account_id
    );

    if (response) {
      return sendResponse(reply, {
        message: t('account_view_successfully'),
        httpStatusCode: EHTTPStatusCode.ok,
        data: response,
      });
    }

    return sendResponse(reply, {
      message: t('account_not_found'),
      httpStatusCode: EHTTPStatusCode.bad_request,
    });
  } catch (error) {
    handleControllerError(error, reply, t);
  }
};
