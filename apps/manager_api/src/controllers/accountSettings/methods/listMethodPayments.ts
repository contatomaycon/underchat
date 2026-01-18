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

    const enabledMethods = response.filter((method) => method.status === true);

    if (!enabledMethods || enabledMethods.length === 0) {
      return sendResponse(reply, {
        message: t('no_enabled_payment_methods'),
        httpStatusCode: EHTTPStatusCode.ok,
        data: [],
      });
    }

    return sendResponse(reply, {
      message: t('method_payments_viewed_successfully'),
      httpStatusCode: EHTTPStatusCode.ok,
      data: enabledMethods,
    });
  } catch (error) {
    handleControllerError(error, reply, t);
  }
};
