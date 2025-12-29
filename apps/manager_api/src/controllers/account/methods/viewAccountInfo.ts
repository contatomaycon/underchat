import { EHTTPStatusCode } from '@core/common/enums/EHTTPStatusCode';
import { sendResponse } from '@core/common/functions/sendResponse';
import { handleControllerError } from '@core/common/functions/handleControllerError';
import { FastifyReply, FastifyRequest } from 'fastify';
import { container } from 'tsyringe';
import { ViewAccountInfoRequest } from '@core/schema/account/viewAccountInfo/request.schema';
import { AccountInfoViewerUseCase } from '@core/useCases/account/AccountInfoViewer.useCase';

export const viewAccountInfo = async (
  request: FastifyRequest<{
    Params: ViewAccountInfoRequest;
  }>,
  reply: FastifyReply
) => {
  const accountInfoViewerUseCase = container.resolve(AccountInfoViewerUseCase);
  const { t } = request;

  try {
    const response = await accountInfoViewerUseCase.execute(
      t,
      request.params.account_id
    );

    if (response) {
      return sendResponse(reply, {
        message: t('account_info_view_successfully'),
        httpStatusCode: EHTTPStatusCode.ok,
        data: response,
      });
    }

    return sendResponse(reply, {
      message: t('account_info_not_found'),
      httpStatusCode: EHTTPStatusCode.bad_request,
    });
  } catch (error) {
    handleControllerError(error, reply, t);
  }
};
