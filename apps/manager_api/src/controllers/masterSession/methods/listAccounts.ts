import { EHTTPStatusCode } from '@core/common/enums/EHTTPStatusCode';
import { sendResponse } from '@core/common/functions/sendResponse';
import { handleControllerError } from '@core/common/functions/handleControllerError';
import { FastifyReply, FastifyRequest } from 'fastify';
import { container } from 'tsyringe';
import { MasterSessionAccountsListerUseCase } from '@core/useCases/masterSession/MasterSessionAccountsLister.useCase';

export const listAccounts = async (
  request: FastifyRequest,
  reply: FastifyReply
) => {
  const masterSessionAccountsListerUseCase = container.resolve(
    MasterSessionAccountsListerUseCase
  );
  const { t, tokenJwtData } = request;

  try {
    const response = await masterSessionAccountsListerUseCase.execute(
      tokenJwtData.account_id
    );

    return sendResponse(reply, {
      message: t('account_list_successfully'),
      httpStatusCode: EHTTPStatusCode.ok,
      data: response,
    });
  } catch (error) {
    handleControllerError(error, reply, t);
  }
};
