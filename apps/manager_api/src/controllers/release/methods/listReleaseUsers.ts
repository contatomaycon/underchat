import { EHTTPStatusCode } from '@core/common/enums/EHTTPStatusCode';
import { sendResponse } from '@core/common/functions/sendResponse';
import { handleControllerError } from '@core/common/functions/handleControllerError';
import { FastifyReply, FastifyRequest } from 'fastify';
import { container } from 'tsyringe';
import { ReleaseUsersListerUseCase } from '@core/useCases/release/ReleaseUsersLister.useCase';

export const listReleaseUsers = async (
  request: FastifyRequest,
  reply: FastifyReply
) => {
  const releaseUsersListerUseCase = container.resolve(
    ReleaseUsersListerUseCase
  );
  const { t, tokenJwtData } = request;

  try {
    const response = await releaseUsersListerUseCase.execute(
      tokenJwtData.account_id
    );

    return sendResponse(reply, {
      message: t('release_users_list_success'),
      httpStatusCode: EHTTPStatusCode.ok,
      data: response,
    });
  } catch (error) {
    handleControllerError(error, reply, t);
  }
};
