import { EHTTPStatusCode } from '@core/common/enums/EHTTPStatusCode';
import { sendResponse } from '@core/common/functions/sendResponse';
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
    console.error(error);

    if (error instanceof Error) {
      return sendResponse(reply, {
        message: error.message,
        httpStatusCode: EHTTPStatusCode.internal_server_error,
      });
    }

    return sendResponse(reply, {
      message: t('internal_server_error'),
      httpStatusCode: EHTTPStatusCode.internal_server_error,
    });
  }
};
