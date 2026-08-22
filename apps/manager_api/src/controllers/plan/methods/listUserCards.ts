import { EHTTPStatusCode } from '@core/common/enums/EHTTPStatusCode';
import { sendResponse } from '@core/common/functions/sendResponse';
import { handleControllerError } from '@core/common/functions/handleControllerError';
import { FastifyReply, FastifyRequest } from 'fastify';
import { container } from 'tsyringe';
import { BillingUserCardsListerUseCase } from '@core/useCases/plan/BillingUserCardsLister.useCase';

export const listUserCards = async (
  request: FastifyRequest,
  reply: FastifyReply
) => {
  const billingUserCardsListerUseCase = container.resolve(
    BillingUserCardsListerUseCase
  );
  const { t, tokenJwtData } = request;

  try {
    const response = await billingUserCardsListerUseCase.execute(
      tokenJwtData.account_id
    );

    return sendResponse(reply, {
      message: t('user_cards_list_successfully'),
      httpStatusCode: EHTTPStatusCode.ok,
      data: response,
    });
  } catch (error) {
    handleControllerError(error, reply, t);
  }
};
