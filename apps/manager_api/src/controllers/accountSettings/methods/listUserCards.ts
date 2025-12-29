import { EHTTPStatusCode } from '@core/common/enums/EHTTPStatusCode';
import { sendResponse } from '@core/common/functions/sendResponse';
import { handleControllerError } from '@core/common/functions/handleControllerError';
import { FastifyReply, FastifyRequest } from 'fastify';
import { container } from 'tsyringe';
import { UserCardsListerUseCase } from '@core/useCases/plan/UserCardsLister.useCase';

export const listUserCards = async (
  request: FastifyRequest,
  reply: FastifyReply
) => {
  const userCardsListerUseCase = container.resolve(UserCardsListerUseCase);
  const { t, tokenJwtData } = request;

  try {
    const response = await userCardsListerUseCase.execute(tokenJwtData.user_id);

    return sendResponse(reply, {
      message: t('cards_listed_successfully'),
      httpStatusCode: EHTTPStatusCode.ok,
      data: response,
    });
  } catch (error) {
    handleControllerError(error, reply, t);
  }
};
