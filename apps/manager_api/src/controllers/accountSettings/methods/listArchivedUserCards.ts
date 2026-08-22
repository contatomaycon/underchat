import { EHTTPStatusCode } from '@core/common/enums/EHTTPStatusCode';
import { handleControllerError } from '@core/common/functions/handleControllerError';
import { sendResponse } from '@core/common/functions/sendResponse';
import { UserArchivedCardsListerUseCase } from '@core/useCases/accountSettings/UserArchivedCardsLister.useCase';
import { FastifyReply, FastifyRequest } from 'fastify';
import { container } from 'tsyringe';

export const listArchivedUserCards = async (
  request: FastifyRequest,
  reply: FastifyReply
) => {
  const userArchivedCardsListerUseCase = container.resolve(
    UserArchivedCardsListerUseCase
  );
  const { t, tokenJwtData } = request;

  try {
    const response = await userArchivedCardsListerUseCase.execute(
      tokenJwtData.account_id
    );

    return sendResponse(reply, {
      message: t('archived_cards_listed_successfully'),
      httpStatusCode: EHTTPStatusCode.ok,
      data: response,
    });
  } catch (error) {
    handleControllerError(error, reply, t);
  }
};
