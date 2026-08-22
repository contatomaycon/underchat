import { EHTTPStatusCode } from '@core/common/enums/EHTTPStatusCode';
import { sendResponse } from '@core/common/functions/sendResponse';
import { handleControllerError } from '@core/common/functions/handleControllerError';
import type { FastifyReply, FastifyRequest } from 'fastify';
import { container } from 'tsyringe';
import { UserListerAllUseCase } from '@core/useCases/user/UserListerAll.useCase';

export const listAllUsers = async (
  request: FastifyRequest,
  reply: FastifyReply
) => {
  const userListerAllUseCase = container.resolve(UserListerAllUseCase);
  const { t, tokenJwtData } = request;

  try {
    const response = await userListerAllUseCase.execute(
      t,
      tokenJwtData.account_id
    );

    return sendResponse(reply, {
      message: t('user_list_successfully'),
      httpStatusCode: EHTTPStatusCode.ok,
      data: response,
    });
  } catch (error) {
    handleControllerError(error, reply, t);
  }
};
