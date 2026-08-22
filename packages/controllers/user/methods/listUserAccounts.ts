import { EHTTPStatusCode } from '@core/common/enums/EHTTPStatusCode';
import { sendResponse } from '@core/common/functions/sendResponse';
import { handleControllerError } from '@core/common/functions/handleControllerError';
import type { FastifyReply, FastifyRequest } from 'fastify';
import { container } from 'tsyringe';
import { UserAccountsListerUseCase } from '@core/useCases/user/UserAccountsLister.useCase';

export const listUserAccounts = async (
  request: FastifyRequest,
  reply: FastifyReply
) => {
  const userAccountsListerUseCase = container.resolve(
    UserAccountsListerUseCase
  );
  const { t } = request;

  try {
    const response = await userAccountsListerUseCase.execute();

    return sendResponse(reply, {
      message: t('user_accounts_list_successfully'),
      httpStatusCode: EHTTPStatusCode.ok,
      data: response,
    });
  } catch (error) {
    handleControllerError(error, reply, t);
  }
};
