import { EHTTPStatusCode } from '@core/common/enums/EHTTPStatusCode';
import { sendResponse } from '@core/common/functions/sendResponse';
import { handleControllerError } from '@core/common/functions/handleControllerError';
import { FastifyReply, FastifyRequest } from 'fastify';
import { container } from 'tsyringe';
import { AccountPaymentNfseGeneratorUseCase } from '@core/useCases/accountSettings/AccountPaymentNfseGenerator.useCase';
import { GenerateAccountPaymentNfseRequest } from '@core/schema/accountSettings/generateAccountPaymentNfse/request.schema';

export const generateAccountPaymentNfse = async (
  request: FastifyRequest<{
    Params: GenerateAccountPaymentNfseRequest;
  }>,
  reply: FastifyReply
) => {
  const accountPaymentNfseGeneratorUseCase = container.resolve(
    AccountPaymentNfseGeneratorUseCase
  );
  const { t, tokenJwtData, params } = request;

  try {
    const response = await accountPaymentNfseGeneratorUseCase.execute(
      t,
      tokenJwtData.account_id,
      params.account_payment_id
    );

    return sendResponse(reply, {
      message: response.message,
      httpStatusCode: EHTTPStatusCode.ok,
      data: response,
    });
  } catch (error) {
    handleControllerError(error, reply, t);
  }
};
