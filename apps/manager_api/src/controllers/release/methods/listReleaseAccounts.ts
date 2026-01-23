import { EHTTPStatusCode } from '@core/common/enums/EHTTPStatusCode';
import { sendResponse } from '@core/common/functions/sendResponse';
import { handleControllerError } from '@core/common/functions/handleControllerError';
import { FastifyReply, FastifyRequest } from 'fastify';
import { container } from 'tsyringe';
import { ReleaseAccountsListerUseCase } from '@core/useCases/release/ReleaseAccountsLister.useCase';

export const listReleaseAccounts = async (
  request: FastifyRequest,
  reply: FastifyReply
) => {
  const releaseAccountsListerUseCase = container.resolve(
    ReleaseAccountsListerUseCase
  );
  const { t, tokenJwtData } = request;

  try {
    const response = await releaseAccountsListerUseCase.execute(
      t,
      tokenJwtData.actions
    );

    return sendResponse(reply, {
      message: t('release_accounts_list_success'),
      httpStatusCode: EHTTPStatusCode.ok,
      data: response,
    });
  } catch (error) {
    handleControllerError(error, reply, t);
  }
};
