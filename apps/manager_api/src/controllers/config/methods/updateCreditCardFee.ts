import { EHTTPStatusCode } from '@core/common/enums/EHTTPStatusCode';
import { sendResponse } from '@core/common/functions/sendResponse';
import { FastifyReply, FastifyRequest } from 'fastify';
import { container } from 'tsyringe';
import { UpdateCreditCardFeeRequest } from '@core/schema/config/updateCreditCardFee/request.schema';
import { CreditCardFeeUpserterUseCase } from '@core/useCases/config/CreditCardFeeUpserter.useCase';

export const updateCreditCardFee = async (
  request: FastifyRequest,
  reply: FastifyReply
) => {
  const creditCardFeeUpserterUseCase = container.resolve(
    CreditCardFeeUpserterUseCase
  );
  const { t } = request;
  const payload = request.body as UpdateCreditCardFeeRequest;

  try {
    const response = await creditCardFeeUpserterUseCase.execute(t, payload);

    return sendResponse(reply, {
      message: t('credit_card_fee_updated_successfully'),
      httpStatusCode: EHTTPStatusCode.ok,
      data: response,
    });
  } catch (error) {
    console.error(error);

    if (error instanceof Error) {
      const notFoundMessage = t('credit_card_fee_not_found');
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
