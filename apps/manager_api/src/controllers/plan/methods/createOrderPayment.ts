import { EHTTPStatusCode } from '@core/common/enums/EHTTPStatusCode';
import { sendResponse } from '@core/common/functions/sendResponse';
import { handleControllerError } from '@core/common/functions/handleControllerError';
import { getClientIp } from '@core/common/functions/getClientIp';
import { FastifyReply, FastifyRequest } from 'fastify';
import { container } from 'tsyringe';
import { OrderPaymentCreatorUseCase } from '@core/useCases/plan/OrderPaymentCreator.useCase';
import { CreateOrderPaymentRequest } from '@core/schema/plan/createOrderPayment/request.schema';

export const createOrderPayment = async (
  request: FastifyRequest<{ Body: CreateOrderPaymentRequest }>,
  reply: FastifyReply
) => {
  const orderPaymentCreatorUseCase = container.resolve(
    OrderPaymentCreatorUseCase
  );
  const { t, tokenJwtData } = request;

  try {
    const remoteIp = getClientIp(request);

    const response = await orderPaymentCreatorUseCase.execute(
      t,
      tokenJwtData.account_id,
      request.body,
      remoteIp
    );

    return sendResponse(reply, {
      message: t('order_payment_created_successfully'),
      httpStatusCode: EHTTPStatusCode.ok,
      data: response,
    });
  } catch (error) {
    handleControllerError(error, reply, t);
  }
};
