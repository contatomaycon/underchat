import { EHTTPStatusCode } from '@core/common/enums/EHTTPStatusCode';
import { sendResponse } from '@core/common/functions/sendResponse';
import { handleControllerError } from '@core/common/functions/handleControllerError';
import { FastifyReply, FastifyRequest } from 'fastify';
import { container } from 'tsyringe';
import { AccountPaymentNfseViewerUseCase } from '@core/useCases/account/AccountPaymentNfseViewer.useCase';
import { ViewAccountPaymentNfseRequest } from '@core/schema/account/viewAccountPaymentNfse/request.schema';

export const viewAccountPaymentNfse = async (
  request: FastifyRequest<{
    Params: ViewAccountPaymentNfseRequest;
  }>,
  reply: FastifyReply
) => {
  const accountPaymentNfseViewerUseCase = container.resolve(
    AccountPaymentNfseViewerUseCase
  );
  const { t, params } = request;

  try {
    const response = await accountPaymentNfseViewerUseCase.execute(
      t,
      params.account_id,
      params.account_payment_id
    );

    return sendResponse(reply, {
      message: t('account_payment_nfse_viewed_successfully'),
      httpStatusCode: EHTTPStatusCode.ok,
      data: response,
    });
  } catch (error) {
    handleControllerError(error, reply, t);
  }
};
