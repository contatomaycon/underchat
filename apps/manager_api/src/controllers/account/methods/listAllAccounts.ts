import { EHTTPStatusCode } from '@core/common/enums/EHTTPStatusCode';
import { sendResponse } from '@core/common/functions/sendResponse';
import { handleControllerError } from '@core/common/functions/handleControllerError';
import { FastifyReply, FastifyRequest } from 'fastify';
import { container } from 'tsyringe';
import { AccountAllListerUseCase } from '@core/useCases/account/AccountAllLister.useCase';

export const listAllAccounts = async (
  request: FastifyRequest,
  reply: FastifyReply
) => {
  const accountAllListerUseCase = container.resolve(AccountAllListerUseCase);
  const { t } = request;

  try {
    const response = await accountAllListerUseCase.execute();

    return sendResponse(reply, {
      message: t('account_list_successfully'),
      httpStatusCode: EHTTPStatusCode.ok,
      data: response,
    });
  } catch (error) {
    handleControllerError(error, reply, t);
  }
};
