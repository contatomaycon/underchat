import { EHTTPStatusCode } from '@core/common/enums/EHTTPStatusCode';
import { sendResponse } from '@core/common/functions/sendResponse';
import { handleControllerError } from '@core/common/functions/handleControllerError';
import { FastifyReply, FastifyRequest } from 'fastify';
import { container } from 'tsyringe';
import { MethodPaymentUpdaterUseCase } from '@core/useCases/config/MethodPaymentUpdater.useCase';
import { UpdateMethodPaymentRequest } from '@core/schema/config/updateMethodPayment/request.schema';

export const updateMethodPayment = async (
  request: FastifyRequest<{
    Body: UpdateMethodPaymentRequest;
  }>,
  reply: FastifyReply
) => {
  const methodPaymentUpdaterUseCase = container.resolve(
    MethodPaymentUpdaterUseCase
  );
  const { t } = request;

  try {
    const response = await methodPaymentUpdaterUseCase.execute(t, request.body);

    if (!response) {
      return sendResponse(reply, {
        message: t('method_payment_not_found'),
        httpStatusCode: EHTTPStatusCode.bad_request,
      });
    }

    return sendResponse(reply, {
      message: t('method_payment_updated_successfully'),
      httpStatusCode: EHTTPStatusCode.ok,
      data: response,
    });
  } catch (error) {
    handleControllerError(error, reply, t);
  }
};
