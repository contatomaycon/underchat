import { EHTTPStatusCode } from '@core/common/enums/EHTTPStatusCode';
import { sendResponse } from '@core/common/functions/sendResponse';
import { FastifyReply, FastifyRequest } from 'fastify';
import { container } from 'tsyringe';
import { AccountPaymentNfseViewerUseCase } from '@core/useCases/accountSettings/AccountPaymentNfseViewer.useCase';
import { ViewAccountPaymentNfseRequest } from '@core/schema/accountSettings/viewAccountPaymentNfse/request.schema';

export const viewAccountPaymentNfse = async (
  request: FastifyRequest<{
    Params: ViewAccountPaymentNfseRequest;
  }>,
  reply: FastifyReply
) => {
  const accountPaymentNfseViewerUseCase = container.resolve(
    AccountPaymentNfseViewerUseCase
  );
  const { t, tokenJwtData, params } = request;

  try {
    const response = await accountPaymentNfseViewerUseCase.execute(
      t,
      tokenJwtData.account_id,
      params.account_payment_id
    );

    return sendResponse(reply, {
      message: t('account_payment_nfse_viewed_successfully'),
      httpStatusCode: EHTTPStatusCode.ok,
      data: response,
    });
  } catch (error) {
    console.error(error);

    if (error instanceof Error) {
      const notFoundMessage = t('account_payment_nfse_not_found');
      const isNotFound = error.message === notFoundMessage;

      return sendResponse(reply, {
        message: error.message,
        httpStatusCode: isNotFound
          ? EHTTPStatusCode.not_found
          : EHTTPStatusCode.internal_server_error,
      });
    }

    return sendResponse(reply, {
      message: t('internal_server_error'),
      httpStatusCode: EHTTPStatusCode.internal_server_error,
    });
  }
};
