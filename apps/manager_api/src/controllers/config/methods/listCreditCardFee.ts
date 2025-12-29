import { EHTTPStatusCode } from '@core/common/enums/EHTTPStatusCode';
import { sendResponse } from '@core/common/functions/sendResponse';
import { handleControllerError } from '@core/common/functions/handleControllerError';
import { FastifyReply, FastifyRequest } from 'fastify';
import { container } from 'tsyringe';
import { CreditCardFeeViewerUseCase } from '@core/useCases/config/CreditCardFeeViewer.useCase';

export const listCreditCardFee = async (
  request: FastifyRequest,
  reply: FastifyReply
) => {
  const creditCardFeeViewerUseCase = container.resolve(
    CreditCardFeeViewerUseCase
  );
  const { t } = request;

  try {
    const response = await creditCardFeeViewerUseCase.execute(t);

    return sendResponse(reply, {
      message: t('credit_card_fee_viewed_successfully'),
      httpStatusCode: EHTTPStatusCode.ok,
      data: response,
    });
  } catch (error) {
    handleControllerError(error, reply, t);
  }
};
