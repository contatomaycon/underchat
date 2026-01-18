import { EHTTPStatusCode } from '@core/common/enums/EHTTPStatusCode';
import { sendResponse } from '@core/common/functions/sendResponse';
import { handleControllerError } from '@core/common/functions/handleControllerError';
import { FastifyReply, FastifyRequest } from 'fastify';
import { container } from 'tsyringe';
import { MethodPaymentViewerUseCase } from '@core/useCases/config/MethodPaymentViewer.useCase';

export const listMethodPayments = async (
  request: FastifyRequest,
  reply: FastifyReply
) => {
  const methodPaymentViewerUseCase = container.resolve(
    MethodPaymentViewerUseCase
  );
  const { t } = request;

  try {
    const response = await methodPaymentViewerUseCase.execute();

    if (!response) {
      return sendResponse(reply, {
        message: t('method_payment_not_found'),
        httpStatusCode: EHTTPStatusCode.bad_request,
      });
    }

    return sendResponse(reply, {
      message: t('method_payments_viewed_successfully'),
      httpStatusCode: EHTTPStatusCode.ok,
      data: response,
    });
  } catch (error) {
    handleControllerError(error, reply, t);
  }
};
