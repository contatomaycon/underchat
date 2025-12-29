import { EHTTPStatusCode } from '@core/common/enums/EHTTPStatusCode';
import { sendResponse } from '@core/common/functions/sendResponse';
import { handleControllerError } from '@core/common/functions/handleControllerError';
import { FastifyReply, FastifyRequest } from 'fastify';
import { container } from 'tsyringe';
import { UnblockAccountRequest } from '@core/schema/account/unblockAccount/request.schema';
import { AccountUnblockerUseCase } from '@core/useCases/account/AccountUnblocker.useCase';

export const unblockAccount = async (
  request: FastifyRequest<{
    Params: UnblockAccountRequest;
  }>,
  reply: FastifyReply
) => {
  const accountUnblockerUseCase = container.resolve(AccountUnblockerUseCase);
  const { t } = request;

  try {
    const response = await accountUnblockerUseCase.execute(
      request.params.account_id
    );

    if (response) {
      return sendResponse(reply, {
        message: t('account_unblocked_successfully'),
        httpStatusCode: EHTTPStatusCode.ok,
      });
    }

    return sendResponse(reply, {
      message: t('account_unblock_error'),
      httpStatusCode: EHTTPStatusCode.bad_request,
    });
  } catch (error) {
    handleControllerError(error, reply, t);
  }
};
