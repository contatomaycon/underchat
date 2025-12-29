import { EHTTPStatusCode } from '@core/common/enums/EHTTPStatusCode';
import { sendResponse } from '@core/common/functions/sendResponse';
import { handleControllerError } from '@core/common/functions/handleControllerError';
import { FastifyReply, FastifyRequest } from 'fastify';
import { container } from 'tsyringe';
import { UserCardDefaultUpdaterUseCase } from '@core/useCases/accountSettings/UserCardDefaultUpdater.useCase';

export const updateUserCardDefault = async (
  request: FastifyRequest,
  reply: FastifyReply
) => {
  const userCardDefaultUpdaterUseCase = container.resolve(
    UserCardDefaultUpdaterUseCase
  );
  const { t, tokenJwtData, body } = request;

  try {
    const { user_card_id } = body as { user_card_id: string };

    await userCardDefaultUpdaterUseCase.execute(
      t,
      user_card_id,
      tokenJwtData.user_id
    );

    return sendResponse(reply, {
      message: t('card_default_updated_successfully'),
      httpStatusCode: EHTTPStatusCode.ok,
    });
  } catch (error) {
    handleControllerError(error, reply, t);
  }
};
