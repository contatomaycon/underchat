import { EHTTPStatusCode } from '@core/common/enums/EHTTPStatusCode';
import { sendResponse } from '@core/common/functions/sendResponse';
import { handleControllerError } from '@core/common/functions/handleControllerError';
import { getClientIp } from '@core/common/functions/getClientIp';
import { FastifyReply, FastifyRequest } from 'fastify';
import { container } from 'tsyringe';
import { RegisterOrderPaymentCreatorUseCase } from '@core/useCases/register/RegisterOrderPaymentCreator.useCase';
import { CreateRegisterOrderPaymentRequest } from '@core/schema/register/createOrderPayment/request.schema';

export const createOrderPayment = async (
  request: FastifyRequest<{ Body: CreateRegisterOrderPaymentRequest }>,
  reply: FastifyReply
) => {
  const registerOrderPaymentCreatorUseCase = container.resolve(
    RegisterOrderPaymentCreatorUseCase
  );
  const { t, registerJwtData } = request;

  try {
    const remoteIp = getClientIp(request);

    const response = await registerOrderPaymentCreatorUseCase.execute(
      t,
      registerJwtData,
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
