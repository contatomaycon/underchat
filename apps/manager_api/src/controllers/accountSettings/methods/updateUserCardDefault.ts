import { EHTTPStatusCode } from '@core/common/enums/EHTTPStatusCode';
import { sendResponse } from '@core/common/functions/sendResponse';
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
    request.server.logger.error(error, request.id);

    if (error instanceof Error) {
      return sendResponse(reply, {
        message: error.message,
        httpStatusCode: EHTTPStatusCode.internal_server_error,
      });
    }

    return sendResponse(reply, {
      message: t('internal_server_error'),
      httpStatusCode: EHTTPStatusCode.internal_server_error,
    });
  }
};
