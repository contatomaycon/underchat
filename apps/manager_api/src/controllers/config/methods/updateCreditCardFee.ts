import { EHTTPStatusCode } from '@core/common/enums/EHTTPStatusCode';
import { sendResponse } from '@core/common/functions/sendResponse';
import { handleControllerError } from '@core/common/functions/handleControllerError';
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
    handleControllerError(error, reply, t);
  }
};
