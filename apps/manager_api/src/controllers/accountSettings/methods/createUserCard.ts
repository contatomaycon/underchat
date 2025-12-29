import { EHTTPStatusCode } from '@core/common/enums/EHTTPStatusCode';
import { sendResponse } from '@core/common/functions/sendResponse';
import { handleControllerError } from '@core/common/functions/handleControllerError';
import { getClientIp } from '@core/common/functions/getClientIp';
import { FastifyReply, FastifyRequest } from 'fastify';
import { container } from 'tsyringe';
import { UserCardCreatorUseCase } from '@core/useCases/accountSettings/UserCardCreator.useCase';
import { CreateUserCardRequest } from '@core/schema/accountSettings/createUserCard/request.schema';

export const createUserCard = async (
  request: FastifyRequest<{ Body: CreateUserCardRequest }>,
  reply: FastifyReply
): Promise<void> => {
  const userCardCreatorUseCase = container.resolve(UserCardCreatorUseCase);
  const { t, tokenJwtData, body } = request;

  try {
    const remoteIp = getClientIp(request);

    const result = await userCardCreatorUseCase.execute(
      t,
      tokenJwtData.user_id,
      tokenJwtData.account_id,
      remoteIp,
      body
    );

    return sendResponse(reply, {
      message: t('card_created_successfully'),
      data: result,
      httpStatusCode: EHTTPStatusCode.ok,
    });
  } catch (error) {
    handleControllerError(error, reply, t);
  }
};
