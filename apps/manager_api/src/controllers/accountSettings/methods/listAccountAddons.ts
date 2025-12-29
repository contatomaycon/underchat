import { EHTTPStatusCode } from '@core/common/enums/EHTTPStatusCode';
import { sendResponse } from '@core/common/functions/sendResponse';
import { handleControllerError } from '@core/common/functions/handleControllerError';
import { FastifyReply, FastifyRequest } from 'fastify';
import { container } from 'tsyringe';
import { AccountAddonsListerUseCase } from '@core/useCases/accountSettings/AccountAddonsLister.useCase';

export const listAccountAddons = async (
  request: FastifyRequest,
  reply: FastifyReply
) => {
  const accountAddonsListerUseCase = container.resolve(
    AccountAddonsListerUseCase
  );
  const { t, tokenJwtData } = request;

  try {
    const response = await accountAddonsListerUseCase.execute(
      tokenJwtData.account_id
    );

    return sendResponse(reply, {
      message: t('addons_listed_successfully'),
      httpStatusCode: EHTTPStatusCode.ok,
      data: response,
    });
  } catch (error) {
    handleControllerError(error, reply, t);
  }
};
