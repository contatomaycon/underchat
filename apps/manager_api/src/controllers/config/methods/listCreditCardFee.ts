import { EHTTPStatusCode } from '@core/common/enums/EHTTPStatusCode';
import { sendResponse } from '@core/common/functions/sendResponse';
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
