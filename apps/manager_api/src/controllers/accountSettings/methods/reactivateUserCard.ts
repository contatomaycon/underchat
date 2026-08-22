import { EHTTPStatusCode } from '@core/common/enums/EHTTPStatusCode';
import { handleControllerError } from '@core/common/functions/handleControllerError';
import { sendResponse } from '@core/common/functions/sendResponse';
import { ReactivateUserCardRequest } from '@core/schema/accountSettings/reactivateUserCard/request.schema';
import { UserCardReactivatorUseCase } from '@core/useCases/accountSettings/UserCardReactivator.useCase';
import { FastifyReply, FastifyRequest } from 'fastify';
import { container } from 'tsyringe';

export const reactivateUserCard = async (
  request: FastifyRequest<{ Params: ReactivateUserCardRequest }>,
  reply: FastifyReply
) => {
  const userCardReactivatorUseCase = container.resolve(
    UserCardReactivatorUseCase
  );
  const { t, tokenJwtData } = request;

  try {
    const response = await userCardReactivatorUseCase.execute(
      request.params.user_card_id,
      tokenJwtData.account_id
    );

    return sendResponse(reply, {
      message: t('card_reactivated_successfully'),
      httpStatusCode: EHTTPStatusCode.ok,
      data: response,
    });
  } catch (error) {
    handleControllerError(error, reply, t);
  }
};
